"""Read existing podcast transcripts from the user's podcast-learning directory
and produce structured 2-minute Blinkist-style summaries for the portal +
Daily Focus email block.

Inputs:
  /Users/adeomosanya/Documents/job apps/podcast-learning/
    episode_index.json      — metadata for every known episode
    transcripts/*.txt       — raw transcripts (15 currently exist)

Outputs:
  scripts/podcast_digests.json — flat JSON list consumed by ingest pipelines
  app.podcasts.data.js          — JS-importable export consumed by the portal
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

PODCAST_LEARNING_DIR = Path("/Users/adeomosanya/Documents/job apps/podcast-learning")
EPISODE_INDEX = PODCAST_LEARNING_DIR / "episode_index.json"
TRANSCRIPTS_DIR = PODCAST_LEARNING_DIR / "transcripts"

REPO_ROOT = Path(__file__).resolve().parents[3]
OUTPUT_JSON = REPO_ROOT / "scripts" / "podcast_digests.json"
OUTPUT_JS = REPO_ROOT / "app.podcasts.data.js"
STATE_FILE = REPO_ROOT / "scripts" / "podcast_summariser_state.json"

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("JOB_DIGEST_GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

MAX_TRANSCRIPT_CHARS = 24_000  # ~6k tokens — leaves headroom under Groq's 12k TPM ceiling so the rolling-minute limit doesn't stall consecutive calls
RETRY = 4
RETRY_BACKOFF = 5

SYSTEM_PROMPT = """You are summarising product-podcast episodes for Ade Omosanya, a 13-year fincrime / regulated-product manager actively interviewing for Senior PM, Director and Head-of-FinCrime-Product roles. Output strict JSON.

ADE'S CV BEATS — for the "apply_to_prep" field, draw a thread from the episode to one of these where it fits naturally; never force it:
- N26 (BaFin remediation, 470 PEP backlog cleared, 70% EDD review automation, 12 BaFin audit points closed)
- Vistra (Global CLM Product Owner across 20+ jurisdictions; onboarding cycle ~45 to ~20 days; Fenergo / Napier / Enate rollout)
- Elucidate (zero-to-one RegTech SaaS; Tier-1 bank PoC £120k ARR; 40% MAU uplift; 6-week deployment)
- MEMA Consultants (founder; 3 live RegTech products; FCA authorisation advisory)
- FCA Authorisations Division (associate, regulator-side perspective)

REQUIRED JSON SCHEMA:
{
  "headline": "single sharp sentence capturing the central thesis",
  "key_takeaways": ["~30 word bullet", "~30 word bullet", "~30 word bullet"],
  "use_cases": ["~30 word concrete example or scenario from the episode", "~30 word concrete example"],
  "apply_to_prep": "one sentence linking the episode's idea to a specific CV beat above (or to Ade's interview narrative if no direct beat fits)",
  "framework_tags": ["short tag", "short tag"]
}

CONSTRAINTS:
- British English (optimise, organise, programme, behaviour). No em-dashes.
- Lead each takeaway with a verb or a specific noun, never with filler.
- Don't fabricate quotes or numbers not in the transcript.
- Keep apply_to_prep grounded in actual CV beats above, not generic interview tips.
- framework_tags: 1-3 short labels like "north-star metric", "RICE", "JTBD", "OKRs", "discovery sprint", "outcome roadmap" — pull only what's genuinely discussed in the episode.

OUTPUT ONLY THE JSON OBJECT. No preamble, no markdown fences."""


def load_state() -> Dict[str, Any]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {"processed": {}}


def save_state(state: Dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def load_index() -> List[Dict[str, Any]]:
    if not EPISODE_INDEX.exists():
        print(f"ERROR: {EPISODE_INDEX} missing", file=sys.stderr)
        return []
    return json.loads(EPISODE_INDEX.read_text())


def find_transcript(entry: Dict[str, Any]) -> Optional[Path]:
    """Resolve the transcript file path for an index entry."""
    rel = entry.get("transcript_path") or ""
    if rel:
        candidate = PODCAST_LEARNING_DIR / rel
        if candidate.exists():
            return candidate
    # Fallback: fuzzy match on title
    title = entry.get("title", "")
    if not title:
        return None
    norm = re.sub(r"[^a-zA-Z0-9]+", "_", title)[:60]
    for path in TRANSCRIPTS_DIR.glob("*.txt"):
        if re.sub(r"[^a-zA-Z0-9]+", "_", path.stem)[:60] in norm or \
           norm[:30] in re.sub(r"[^a-zA-Z0-9]+", "_", path.stem):
            return path
    return None


def call_groq(transcript_text: str, metadata: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    if not GROQ_API_KEY:
        print("ERROR: GROQ_API_KEY not set", file=sys.stderr)
        return None

    show_name = metadata.get("show") or "Lenny's Podcast"
    user_prompt = (
        "Episode metadata:\n"
        f"  show: {show_name}\n"
        f"  title: {metadata.get('title','')}\n"
        f"  guest: {metadata.get('guest','')}\n"
        f"  published: {metadata.get('published','')}\n"
        f"  topics: {', '.join(metadata.get('topics', []))}\n\n"
        f"Transcript (verbatim):\n{transcript_text}"
    )

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 800,
        "response_format": {"type": "json_object"},
    }

    for attempt in range(RETRY + 1):
        try:
            r = requests.post(GROQ_ENDPOINT, headers=headers, json=body, timeout=90)
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    # Strip code fences if model added them
                    cleaned = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
                    return json.loads(cleaned)
            if r.status_code == 429:
                wait = RETRY_BACKOFF * (2 ** attempt)
                print(f"  rate-limited, sleeping {wait}s", file=sys.stderr)
                time.sleep(min(wait, 60))
                continue
            print(f"  HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
        except Exception as e:
            print(f"  err: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(RETRY_BACKOFF * (attempt + 1))
    return None


def derive_show_from_path(transcript_path: Path) -> str:
    parent = transcript_path.parent.name.lower()
    if "lenny" in parent or "podcast-learning" in parent:
        return "Lenny's Podcast"
    return "Lenny's Podcast"


def process_all(limit: Optional[int] = None) -> List[Dict[str, Any]]:
    state = load_state()
    processed = state.get("processed", {})
    index = load_index()
    out: List[Dict[str, Any]] = []

    # Load existing summaries so we accumulate
    if OUTPUT_JSON.exists():
        try:
            out = json.loads(OUTPUT_JSON.read_text())
        except Exception:
            out = []

    done_keys = {d.get("episode_number") for d in out if d.get("episode_number")}

    n_done = 0
    for entry in index:
        ep = entry.get("episode_number", "")
        if not ep:
            continue
        if ep in done_keys and ep in processed:
            continue
        transcript_path = find_transcript(entry)
        if not transcript_path:
            print(f"[skip] {ep}: no transcript file found", file=sys.stderr)
            continue
        text = transcript_path.read_text(encoding="utf-8", errors="replace")
        if len(text) > MAX_TRANSCRIPT_CHARS:
            text = text[:MAX_TRANSCRIPT_CHARS]
        print(f"[summarise] {ep}: {entry.get('title','')[:60]}", file=sys.stderr)
        meta = dict(entry)
        meta["show"] = entry.get("show") or derive_show_from_path(transcript_path)
        result = call_groq(text, meta)
        if not result:
            print(f"  failed", file=sys.stderr)
            continue
        record = {
            "episode_number": ep,
            "show": meta["show"],
            "title": entry.get("title", ""),
            "guest": entry.get("guest", ""),
            "published": entry.get("published", ""),
            "duration": entry.get("duration", ""),
            "topics": entry.get("topics", []),
            "relevance_score": entry.get("relevance_score", 0),
            "youtube_url": entry.get("youtube_url", ""),
            "spotify_url": entry.get("spotify_url", ""),
            "apple_url": entry.get("apple_url", ""),
            "summary": result,
        }
        # Replace existing or append
        out = [d for d in out if d.get("episode_number") != ep]
        out.append(record)
        processed[ep] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        state["processed"] = processed
        save_state(state)
        # Persist after every success so partial runs are durable
        OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False))
        n_done += 1
        if limit and n_done >= limit:
            break
        # Groq free tier is 12k TPM. Each transcript is ~9-10k tokens, so
        # space requests by 65s to stay under the rolling-minute limit.
        time.sleep(65)

    # Sort newest first
    out.sort(key=lambda d: d.get("published", ""), reverse=True)

    OUTPUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False))

    # Write the JS-importable export for the portal
    js = "// Auto-generated by scripts/job_digest/podcasts/summarise.py — do not edit by hand.\n"
    js += "export const PODCAST_DIGESTS = " + json.dumps(out, indent=2, ensure_ascii=False) + ";\n"
    OUTPUT_JS.write_text(js)

    return out


if __name__ == "__main__":
    limit = None
    if len(sys.argv) > 1 and sys.argv[1].startswith("--limit="):
        limit = int(sys.argv[1].split("=", 1)[1])
    result = process_all(limit=limit)
    print(f"\nDone. Total summaries on disk: {len(result)}", file=sys.stderr)
    print(f"  {OUTPUT_JSON}", file=sys.stderr)
    print(f"  {OUTPUT_JS}", file=sys.stderr)
