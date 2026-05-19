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
import re
import shutil
import subprocess
import sys
import tempfile
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


_VTT_SKIP_PREFIXES = ("WEBVTT", "NOTE", "Kind:", "Language:")


def _vtt_to_text(vtt: str) -> str:
    """Strip VTT formatting + HTML entities + filler markers into plain prose."""
    lines: list[str] = []
    seen: set[str] = set()
    for raw in vtt.splitlines():
        s = raw.strip()
        if not s or s.startswith(_VTT_SKIP_PREFIXES):
            continue
        if "-->" in s or s.isdigit():
            continue
        s = re.sub(r"<[^>]+>", "", s)
        if not s or s in seen:
            continue
        seen.add(s)
        lines.append(s)
    text = " ".join(lines)
    text = (text.replace("&gt;&gt;", "\n")
                .replace("&gt;", ">").replace("&lt;", "<")
                .replace("&amp;", "&").replace("&quot;", '"').replace("&#39;", "'"))
    text = re.sub(r"\[(music|applause|laughter|inaudible)[^\]]*\]", "", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip()


def transcribe_youtube_captions(youtube_url: str) -> Optional[Dict[str, Any]]:
    """Free third fallback: pull YouTube's English auto-captions via yt-dlp.

    Works for any video that has auto-caps generated (most do). Quality is
    surprisingly good on production podcast audio. Used when both Whisper
    legs (Groq + OpenAI) are rate-limited or out of quota.
    """
    if not youtube_url or not shutil.which("yt-dlp"):
        return None
    with tempfile.TemporaryDirectory() as tmpd:
        cmd = [
            "yt-dlp", "--write-auto-sub", "--sub-lang", "en",
            "--skip-download", "--sub-format", "vtt",
            "-o", f"{tmpd}/cap.%(ext)s", youtube_url,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=180)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            print(f"  yt-dlp captions failed: {e}", file=sys.stderr)
            return None
        vtt_files = list(Path(tmpd).glob("*.vtt"))
        if not vtt_files:
            print("  yt-dlp produced no captions (video may have none)", file=sys.stderr)
            return None
        text = _vtt_to_text(vtt_files[0].read_text(encoding="utf-8", errors="replace"))
    if not text:
        return None
    return {"text": text, "duration": None, "provider": "yt-dlp-captions"}


def transcribe(audio_path: Path, youtube_url: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Transcribe audio. Falls through Groq -> OpenAI -> YouTube auto-captions."""
    if not audio_path.exists():
        print(f"audio not found: {audio_path}", file=sys.stderr)
        return None
    size = audio_path.stat().st_size
    if size > MAX_AUDIO_BYTES:
        print(f"audio too large ({size/1024/1024:.1f} MB > 25 MB limit)", file=sys.stderr)
        # Even if the audio is unusable, captions may still work
        if youtube_url:
            print("Trying YouTube captions instead", file=sys.stderr)
            return transcribe_youtube_captions(youtube_url)
        return None
    result = transcribe_groq(audio_path)
    if result and result.get("text"):
        return result
    print("Groq failed; falling back to OpenAI", file=sys.stderr)
    result = transcribe_openai(audio_path)
    if result and result.get("text"):
        return result
    if youtube_url:
        print("OpenAI failed; falling back to YouTube auto-captions", file=sys.stderr)
        return transcribe_youtube_captions(youtube_url)
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m scripts.job_digest.transcribe <audio_file> [youtube_url]", file=sys.stderr)
        sys.exit(2)
    yt = sys.argv[2] if len(sys.argv) > 2 else None
    out = transcribe(Path(sys.argv[1]), youtube_url=yt)
    if not out:
        sys.exit(1)
    print(out.get("text", ""))
