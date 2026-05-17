"""Audio transcription wrapper using Groq's Whisper-large-v3 endpoint.

Used by Workstream B (ingest.py) to transcribe podcast audio files that
are indexed but not yet transcribed in /Users/adeomosanya/Documents/job
apps/podcast-learning/audio/.

Why Groq: free tier, ~30s for a 1hr file, OpenAI-compatible request shape,
the GROQ_API_KEY is already in scripts/.env.

Simple interface:

  result = transcribe(path) -> {"text": str, "duration": float|None}
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import requests

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_WHISPER_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_WHISPER_MODEL = "whisper-large-v3"

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
OPENAI_WHISPER_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_WHISPER_MODEL = "whisper-1"

# Groq's audio endpoint accepts files up to 25 MB.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _post_with_retry(url: str, headers: Dict[str, str], files, data, retries: int = 3) -> Optional[Dict[str, Any]]:
    last_err: Any = None
    for attempt in range(retries + 1):
        try:
            r = requests.post(url, headers=headers, files=files, data=data, timeout=240)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                wait = min(120, 20 * (attempt + 1))
                print(f"  rate-limited, sleeping {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            last_err = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
        time.sleep(10 * (attempt + 1))
    print(f"  transcribe failed: {last_err}", file=sys.stderr)
    return None


def transcribe_groq(audio_path: Path) -> Optional[Dict[str, Any]]:
    if not GROQ_API_KEY:
        return None
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
    with audio_path.open("rb") as f:
        files = {"file": (audio_path.name, f, "audio/mpeg")}
        data = {"model": GROQ_WHISPER_MODEL, "response_format": "verbose_json"}
        result = _post_with_retry(GROQ_WHISPER_ENDPOINT, headers, files, data)
    if not result:
        return None
    return {
        "text": (result.get("text") or "").strip(),
        "duration": result.get("duration"),
        "provider": "groq",
    }


def transcribe_openai(audio_path: Path) -> Optional[Dict[str, Any]]:
    if not OPENAI_API_KEY:
        return None
    headers = {"Authorization": f"Bearer {OPENAI_API_KEY}"}
    with audio_path.open("rb") as f:
        files = {"file": (audio_path.name, f, "audio/mpeg")}
        data = {"model": OPENAI_WHISPER_MODEL, "response_format": "verbose_json"}
        result = _post_with_retry(OPENAI_WHISPER_ENDPOINT, headers, files, data)
    if not result:
        return None
    return {
        "text": (result.get("text") or "").strip(),
        "duration": result.get("duration"),
        "provider": "openai",
    }


def transcribe(audio_path: Path) -> Optional[Dict[str, Any]]:
    """Transcribe an audio file. Tries Groq first; falls back to OpenAI."""
    if not audio_path.exists():
        print(f"audio not found: {audio_path}", file=sys.stderr)
        return None
    size = audio_path.stat().st_size
    if size > MAX_AUDIO_BYTES:
        print(f"audio too large ({size/1024/1024:.1f} MB > 25 MB limit)", file=sys.stderr)
        return None
    result = transcribe_groq(audio_path)
    if result and result.get("text"):
        return result
    print("Groq failed; falling back to OpenAI", file=sys.stderr)
    result = transcribe_openai(audio_path)
    return result


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.job_digest.transcribe <audio_file>", file=sys.stderr)
        sys.exit(2)
    out = transcribe(Path(sys.argv[1]))
    if not out:
        sys.exit(1)
    print(out.get("text", ""))
