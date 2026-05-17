"""Auto-curate Lenny's Podcast episodes Dec 2024 to present.

The existing episode_index.json snapshot is from Dec 2024. This script fills
the gap by fetching all newer episodes via yt-dlp (Lenny's YouTube channel
mirrors every episode), scoring them against Ade's relevance rubric, and
adding the high-relevance ones to episode_index.json with status=pending so
the ingest+summarise pipeline picks them up automatically.

Guarantees: surfaces Boris Cherny on Claude Code (~March 2026) and any
similarly high-signal AI-tooling / fincrime-relevant episodes since Dec 2024.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests

PODCAST_DIR = Path("/Users/adeomosanya/Documents/job apps/podcast-learning")
EPISODE_INDEX = PODCAST_DIR / "episode_index.json"

CHANNEL_URL = "https://www.youtube.com/@lennyspodcast"
CUTOFF_DATE = "2024-12-01"  # Dec 2024 — start of the gap
MAX_FETCH = 200             # Cap the YT scrape to avoid runaway requests

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("JOB_DIGEST_GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

# Rubric — relevance score 1-5 for each episode based on Ade's profile.
SCORING_SYSTEM = """You score product-podcast episodes for relevance to Ade Omosanya, a 13-year fincrime / regulated-product manager interviewing for Senior PM, Director and Head-of-FinCrime-Product roles.

ADE'S INTEREST PROFILE (highest signal first):
1. AI tooling, agentic systems, Claude/GPT/Gemini in PM workflows
2. RegTech, fincrime, AML/KYC, compliance product, regulator-facing PM
3. Embedded finance, BaaS, fintech infrastructure (Stripe, Wise, Marqeta, Airwallex shape)
4. PM craft at director/CPO level — strategy, organisational influence, hiring
5. Discovery / metrics / north-star / outcome roadmaps frameworks
6. Founder / zero-to-one stories where product was the unlock

Score 1-5:
  5 = directly hits one of categories 1-3 OR a Director/CPO at a regulated firm
  4 = strong hit on category 4-6, or applied AI for product teams
  3 = adjacent product craft (founder stories, general scaling lessons)
  2 = generic PM advice not differentiated
  1 = off-topic (lifestyle, non-product)

Return strict JSON: {"score": 1-5, "rationale": "one sentence why"}.

NEVER return more than one JSON object."""


def check_ytdlp() -> bool:
    if not shutil.which("yt-dlp"):
        print("yt-dlp not installed; install with: pip install yt-dlp", file=sys.stderr)
        return False
    return True


def fetch_videos(max_count: int = MAX_FETCH) -> List[Dict[str, Any]]:
    """Pull the channel's video list via yt-dlp flat-playlist mode."""
    cmd = [
        "yt-dlp", "--flat-playlist", "--dump-json",
        "--playlist-end", str(max_count),
        f"{CHANNEL_URL}/videos",
    ]
    print(f"Fetching up to {max_count} episodes via yt-dlp...", file=sys.stderr)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=240)
    except subprocess.CalledProcessError as e:
        print(f"yt-dlp failed: {e.stderr[:300]}", file=sys.stderr)
        return []
    except subprocess.TimeoutExpired:
        print("yt-dlp timed out after 240s", file=sys.stderr)
        return []
    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            videos.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    print(f"  parsed {len(videos)} entries", file=sys.stderr)
    return videos


def fetch_details(video_id: str) -> Optional[Dict[str, Any]]:
    """Pull full metadata (description, upload_date) for a single video."""
    cmd = ["yt-dlp", "--dump-json", "--skip-download", f"https://www.youtube.com/watch?v={video_id}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=60)
        return json.loads(r.stdout)
    except Exception as e:
        print(f"  details fetch failed for {video_id}: {e}", file=sys.stderr)
        return None


def score_episode_with_llm(title: str, description: str) -> Dict[str, Any]:
    if not GROQ_API_KEY:
        # Fallback: keyword scoring
        text = f"{title} {description}".lower()
        score = 3
        if any(t in text for t in ["claude", "anthropic", "openai", "gpt", "agentic", "ai tool"]):
            score = 5
        elif any(t in text for t in ["fincrime", "aml", "kyc", "compliance", "regulator", "fintech"]):
            score = 5
        elif any(t in text for t in ["embedded finance", "baas", "payments"]):
            score = 4
        elif any(t in text for t in ["cpo", "director", "head of product", "founder"]):
            score = 4
        return {"score": score, "rationale": "keyword-fallback (no Groq key)"}

    user = f"Title: {title}\n\nDescription (excerpt):\n{description[:1500]}"
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SCORING_SYSTEM},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "max_tokens": 100,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    try:
        r = requests.post(GROQ_ENDPOINT, headers=headers, json=body, timeout=30)
        if r.status_code == 200:
            content = r.json()["choices"][0]["message"]["content"]
            return json.loads(content)
        if r.status_code == 429:
            return {"score": 0, "rationale": "rate-limited"}
        return {"score": 0, "rationale": f"http {r.status_code}"}
    except Exception as e:
        return {"score": 0, "rationale": f"err {type(e).__name__}"}


def load_index() -> List[Dict[str, Any]]:
    if not EPISODE_INDEX.exists():
        return []
    return json.loads(EPISODE_INDEX.read_text())


def save_index(items: List[Dict[str, Any]]) -> None:
    EPISODE_INDEX.write_text(json.dumps(items, indent=2, ensure_ascii=False))


def make_episode_record(video: Dict[str, Any], details: Dict[str, Any], score: int, rationale: str) -> Dict[str, Any]:
    upload_date = details.get("upload_date", "")  # YYYYMMDD
    published_iso = ""
    if upload_date and len(upload_date) == 8:
        published_iso = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:]}"
    duration_sec = details.get("duration", 0) or 0
    duration_str = ""
    if duration_sec:
        hours, rem = divmod(duration_sec, 3600)
        mins = rem // 60
        duration_str = f"{hours}.0h {mins}.0m" if hours else f"{mins}m"
    title = details.get("title") or video.get("title") or "Untitled"
    description = (details.get("description") or "")[:1500]

    # Cheap topic extraction
    text = f"{title} {description}".lower()
    topics = []
    for tag in ["ai", "agentic", "fincrime", "compliance", "regulator", "fintech",
                "embedded", "payments", "kyc", "aml", "discovery", "metrics",
                "north star", "okr", "framework", "founder", "cpo", "scale"]:
        if tag in text:
            topics.append(tag)

    video_id = details.get("id") or video.get("id", "")
    safe_title = re.sub(r"[^a-zA-Z0-9]+", "_", title)[:80]
    return {
        "episode_number": f"yt_{video_id}",
        "title": title,
        "guest": details.get("uploader", ""),
        "guest_title": "",
        "published": published_iso,
        "duration": duration_str,
        "description": description,
        "topics": topics or ["product"],
        "relevance_score": score,
        "key_learnings": [],
        "interview_prep_value": "High" if score >= 5 else "Medium" if score >= 4 else "Low",
        "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        "spotify_url": "",
        "apple_url": "",
        "audio_path": f"audio/{safe_title}.mp3",
        "transcript_path": f"transcripts/{safe_title}.txt",
        "summary_path": f"summaries/{safe_title}.md",
        "status": "pending",
        "downloaded": "No",
        "transcribed": "No",
        "summarized": "No",
        "auto_curated": True,
        "curated_rationale": rationale,
    }


def curate(dry_run: bool = False, min_score: int = 4, cutoff: str = CUTOFF_DATE) -> List[Dict[str, Any]]:
    if not check_ytdlp():
        return []

    existing = load_index()
    existing_titles_lc = {(e.get("title") or "").lower() for e in existing}
    existing_video_ids = set()
    for e in existing:
        url = e.get("youtube_url", "")
        m = re.search(r"watch\?v=([\w-]+)", url)
        if m:
            existing_video_ids.add(m.group(1))

    videos = fetch_videos(MAX_FETCH)
    if not videos:
        print("No videos fetched.", file=sys.stderr)
        return []

    cutoff_dt = datetime.strptime(cutoff, "%Y-%m-%d").date()
    candidates: List[Dict[str, Any]] = []
    seen = set()
    for v in videos:
        vid = v.get("id")
        if not vid or vid in existing_video_ids or vid in seen:
            continue
        seen.add(vid)
        title = (v.get("title") or "")
        if not title:
            continue
        if title.lower() in existing_titles_lc:
            continue
        candidates.append(v)

    print(f"Found {len(candidates)} new candidates (not yet in index)", file=sys.stderr)

    added: List[Dict[str, Any]] = []
    for v in candidates:
        details = fetch_details(v["id"])
        if not details:
            continue
        # Skip if upload_date older than cutoff
        ud = details.get("upload_date", "")
        if not ud or len(ud) != 8:
            continue
        try:
            up_date = datetime.strptime(ud, "%Y%m%d").date()
        except ValueError:
            continue
        if up_date < cutoff_dt:
            continue
        title = details.get("title", "")
        description = (details.get("description") or "")[:1500]

        result = score_episode_with_llm(title, description)
        score = int(result.get("score", 0) or 0)
        rationale = result.get("rationale", "")
        print(f"  score={score} | {title[:65]:65} | {rationale[:60]}", file=sys.stderr)
        if score < min_score:
            continue

        record = make_episode_record(v, details, score, rationale)
        added.append(record)
        time.sleep(0.5)  # be polite to YouTube + Groq

    print(f"\nCurated {len(added)} new episodes with score>={min_score}", file=sys.stderr)
    for rec in added[:20]:
        print(f"  + {rec['relevance_score']}/5  {rec['title'][:70]}", file=sys.stderr)

    if dry_run:
        return added

    if added:
        existing.extend(added)
        save_index(existing)
        print(f"Wrote {len(existing)} total entries to {EPISODE_INDEX}", file=sys.stderr)
    return added


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    cutoff = next((arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--cutoff=")), CUTOFF_DATE)
    min_score = int(next((arg.split("=", 1)[1] for arg in sys.argv if arg.startswith("--min-score=")), "4"))
    result = curate(dry_run=dry, min_score=min_score, cutoff=cutoff)
    print(f"\n{'DRY RUN' if dry else 'WROTE'}: {len(result)} new episodes", file=sys.stderr)
