"""Interview Replay — extract candidate's actual spoken answer per question
from existing interview transcripts, generate a refined version and tag the
framework used. Writes back into app.ilog.js SEED_DATA.

Inputs:
  /Users/adeomosanya/Documents/job apps/interview-transcripts/*.txt
  app.ilog.js SEED_DATA (existing 11 interviews + 312 questions)

Outputs:
  app.ilog.js with candidate_answer / refined_answer / framework fields
  added to every matched question.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
APP_ILOG_PATH = REPO_ROOT / "app.ilog.js"

TRANSCRIPT_DIR = Path("/Users/adeomosanya/Documents/job apps/interview-transcripts")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_MODEL = os.environ.get("JOB_DIGEST_GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

CHUNK_CHARS = 30_000   # ~7.5k tokens per chunk
CHUNK_OVERLAP = 4_000  # ~1k tokens overlap so questions on boundaries aren't lost
QUESTIONS_PER_CALL = 5
PACING_SECONDS = 30
MAX_RETRIES = 5

CONFIDENCE_THRESHOLD = 0.6  # below this we leave candidate_answer empty


EXTRACT_SYSTEM = """You extract candidate answers from an interview transcript for Ade Omosanya (13-year fincrime / regulated PM).

INPUT: a transcript chunk (verbatim, may have no speaker tags) + a list of N questions, each tagged with an ID.

For each question:
- Find the candidate's spoken answer within the chunk. The "candidate" is Ade — he is being interviewed, so the answer is whatever he says in response to the question.
- Return the verbatim answer text (no paraphrasing). If the question was paraphrased by the interviewer, match on intent not exact wording.
- Provide a confidence score 0.0-1.0 reflecting how confident you are the extracted text is genuinely Ade's response to that question (not unrelated chatter, not the interviewer's words).
- If you cannot find a clear answer within this chunk: return empty string + confidence 0.

OUTPUT: strict JSON with this shape (one entry per input question):
{
  "answers": [
    {"qid": "qNN", "answer": "verbatim text or empty", "confidence": 0.0-1.0}
  ]
}

NEVER fabricate answers. Empty + low confidence is correct when the chunk doesn't contain the answer.
Output ONLY the JSON object."""


REFINE_SYSTEM = """You refine Ade Omosanya's interview answer.

INPUT: question text + Ade's actual answer (verbatim from transcript, often colloquial and meandering since spoken).

OUTPUT strict JSON:
{
  "framework": "STAR | CAI | RICE | MoSCoW | JTBD | North Star | OKRs | none",
  "refined_answer": "tightened version preserving Ade's voice, ~70-110 words"
}

CV BEATS to anchor refinements:
- Vistra (Global CLM, 20+ jurisdictions, 45 to 20 day onboarding cycle, Fenergo / Napier / Enate)
- N26 (BaFin remediation, 470 PEP backlog cleared, 70% EDD automation, 12 audit points closed)
- Elucidate (Tier-1 PoC £120k ARR, 8 firms onboarded, 40% MAU, 6-week deployment)
- MEMA Consultants (founder, 3 live RegTech products)
- FCA Authorisations (associate, regulator-side perspective)

REFINEMENT RULES:
- Preserve Ade's word choice and stance. Don't replace his examples with new ones.
- Sharpen the structure to match the chosen framework.
- Lead with a metric where the CV supports it.
- 70-110 words, 3-4 sentences max.
- British English. No em-dashes.
- Framework "none" is valid when no framework genuinely applies (e.g. yes/no clarification questions).

Output ONLY the JSON object."""


def find_transcript_for(company: str, role: str, date: str) -> Optional[Path]:
    """Match an interview's date+company to a transcript file."""
    if not TRANSCRIPT_DIR.exists():
        return None
    # Most filenames contain the date in YYYY-MM-DD format
    for path in TRANSCRIPT_DIR.glob("*.txt"):
        name = path.stem
        if date in name:
            return path
        # Loose match by date stripped of dashes
        if date.replace("-", "") in name.replace("-", ""):
            return path
    # Fallback: match by company name (e.g. Railsr, Wise, Spendesk in filename)
    company_lower = (company or "").lower()
    for path in TRANSCRIPT_DIR.glob("*.txt"):
        if company_lower and company_lower.split()[0] in path.stem.lower():
            if date in path.stem:
                return path
    return None


def chunk_text(text: str, size: int = CHUNK_CHARS, overlap: int = CHUNK_OVERLAP) -> List[str]:
    if len(text) <= size:
        return [text]
    chunks = []
    pos = 0
    while pos < len(text):
        chunk = text[pos:pos + size]
        chunks.append(chunk)
        if pos + size >= len(text):
            break
        pos += size - overlap
    return chunks


def call_groq_json(system: str, user: str) -> Optional[Dict[str, Any]]:
    if not GROQ_API_KEY:
        return None
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": 0.1,
        "max_tokens": 1500,
        "response_format": {"type": "json_object"},
    }
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = requests.post(GROQ_ENDPOINT, headers=headers, json=body, timeout=90)
            if r.status_code == 200:
                content = r.json()["choices"][0]["message"]["content"]
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    cleaned = re.sub(r"^```(?:json)?|```$", "", content.strip(), flags=re.M).strip()
                    return json.loads(cleaned)
            if r.status_code == 429:
                wait = min(60, 10 * (attempt + 1))
                print(f"    rate-limited, sleeping {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            print(f"    HTTP {r.status_code}: {r.text[:200]}", file=sys.stderr)
            return None
        except Exception as e:
            print(f"    err: {type(e).__name__}: {e}", file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    return None


def extract_answers_for_chunk(chunk: str, questions: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Run a batch of up to QUESTIONS_PER_CALL questions against one transcript chunk."""
    q_block = "\n".join(f'  {q["id"]}: "{q["text"][:200]}"' for q in questions)
    user = (
        f"Transcript chunk:\n\"\"\"\n{chunk}\n\"\"\"\n\n"
        f"Questions to find answers for:\n{q_block}\n\n"
        "Return strict JSON: {\"answers\": [{\"qid\": \"...\", \"answer\": \"...\", \"confidence\": 0.0-1.0}, ...]}"
    )
    result = call_groq_json(EXTRACT_SYSTEM, user)
    if not result or "answers" not in result:
        return {}
    out = {}
    for a in result.get("answers", []):
        qid = a.get("qid")
        if qid:
            out[qid] = {
                "answer": (a.get("answer") or "").strip(),
                "confidence": float(a.get("confidence", 0) or 0),
            }
    return out


def refine_answer(question_text: str, actual_answer: str) -> Optional[Dict[str, str]]:
    if not actual_answer:
        return None
    user = f"Question: {question_text}\n\nAde's actual spoken answer (verbatim):\n\"\"\"\n{actual_answer}\n\"\"\""
    return call_groq_json(REFINE_SYSTEM, user)


def process_interview(transcript_text: str, questions: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Extract+refine answers for all questions in one interview."""
    chunks = chunk_text(transcript_text)
    print(f"  transcript: {len(transcript_text)} chars, {len(chunks)} chunks", file=sys.stderr)

    # Phase 1: extract candidate answers across chunks, keep highest-confidence per qid
    best_extracts: Dict[str, Dict[str, Any]] = {}
    for ci, chunk in enumerate(chunks):
        for batch_start in range(0, len(questions), QUESTIONS_PER_CALL):
            batch = questions[batch_start:batch_start + QUESTIONS_PER_CALL]
            print(f"  chunk {ci+1}/{len(chunks)}  qs {batch_start+1}-{batch_start+len(batch)}", file=sys.stderr)
            extracts = extract_answers_for_chunk(chunk, batch)
            for qid, e in extracts.items():
                prev = best_extracts.get(qid)
                if not prev or e["confidence"] > prev["confidence"]:
                    best_extracts[qid] = e
            time.sleep(PACING_SECONDS)

    # Phase 2: refine the high-confidence extracts
    refined: Dict[str, Dict[str, Any]] = {}
    for q in questions:
        qid = q["id"]
        extract = best_extracts.get(qid)
        if not extract or extract["confidence"] < CONFIDENCE_THRESHOLD or not extract["answer"]:
            refined[qid] = {
                "candidate_answer": "",
                "framework": "",
                "refined_answer": "",
                "confidence": extract["confidence"] if extract else 0.0,
            }
            continue
        print(f"  refining {qid} (confidence {extract['confidence']:.2f})", file=sys.stderr)
        r = refine_answer(q["text"], extract["answer"])
        time.sleep(PACING_SECONDS)
        refined[qid] = {
            "candidate_answer": extract["answer"],
            "framework": (r or {}).get("framework", ""),
            "refined_answer": (r or {}).get("refined_answer", ""),
            "confidence": extract["confidence"],
        }
    return refined


def load_seed_data() -> Tuple[str, List[Dict[str, Any]], re.Match]:
    src = APP_ILOG_PATH.read_text()
    m = re.search(r"const SEED_DATA = (\[.*?\]);\s*\n", src, re.DOTALL)
    if not m:
        raise RuntimeError("SEED_DATA not found in app.ilog.js")
    return src, json.loads(m.group(1)), m


def save_seed_data(src: str, m: re.Match, data: List[Dict[str, Any]]) -> None:
    new_json = json.dumps(data, ensure_ascii=False)
    new_src = src[: m.start()] + f"const SEED_DATA = {new_json};\n" + src[m.end():]
    APP_ILOG_PATH.write_text(new_src)


def run(only_interview_id: Optional[str] = None, limit: Optional[int] = None) -> None:
    src, data, marker = load_seed_data()
    processed = 0
    for iv in data:
        iv_id = iv.get("id", "")
        if only_interview_id and iv_id != only_interview_id:
            continue
        company = iv.get("company", "")
        role = iv.get("role", "")
        date = iv.get("date", "")
        transcript_path = find_transcript_for(company, role, date)
        if not transcript_path:
            print(f"[skip] {iv_id}: no transcript found for {company} {date}", file=sys.stderr)
            continue
        # Skip if we already have data on all questions
        questions = [q for q in iv.get("questions", []) if q.get("category") != "Candidate Questions" and (q.get("text") or "").strip()]
        if not questions:
            continue
        already_done = sum(1 for q in questions if q.get("candidate_answer") or q.get("refined_answer"))
        if already_done >= len(questions):
            print(f"[skip] {iv_id}: already processed", file=sys.stderr)
            continue
        print(f"\n=== {iv_id} | {company} | {date} ===", file=sys.stderr)
        print(f"  transcript: {transcript_path.name}", file=sys.stderr)
        transcript = transcript_path.read_text(encoding="utf-8", errors="replace")

        refined = process_interview(transcript, questions)

        for q in iv["questions"]:
            r = refined.get(q.get("id", ""))
            if not r:
                continue
            if r["candidate_answer"]:
                q["candidate_answer"] = r["candidate_answer"]
            if r["refined_answer"]:
                q["refined_answer"] = r["refined_answer"]
            if r["framework"] and r["framework"] != "none":
                q["framework"] = r["framework"]
        # Persist after every interview so partial runs are durable
        save_seed_data(src, marker, data)
        # Reload markers (they shift after rewrite)
        src, data, marker = load_seed_data()
        processed += 1
        if limit and processed >= limit:
            break

    print(f"\nDone. Interviews processed: {processed}", file=sys.stderr)


if __name__ == "__main__":
    only = None
    limit = None
    for arg in sys.argv[1:]:
        if arg.startswith("--id="):
            only = arg.split("=", 1)[1]
        elif arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])
    run(only_interview_id=only, limit=limit)
