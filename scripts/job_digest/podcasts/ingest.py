"""Workstream B — backfill podcast transcripts for episodes that are
indexed in episode_index.json but don't yet have a transcript.

Per fire we process at most N=2 episodes to stay under the 25-min
workflow timeout. After each successful transcription we update the
index (transcribed=Yes) and write the transcript to
transcripts/<filename>.txt so the summariser picks it up on the next run.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

# Import the shared transcribe wrapper
from job_digest.transcribe import transcribe  # type: ignore  # noqa: E402

PODCAST_DIR = Path("/Users/adeomosanya/Documents/job apps/podcast-learning")
EPISODE_INDEX = PODCAST_DIR / "episode_index.json"
AUDIO_DIR = PODCAST_DIR / "audio"
AUDIO_COMPRESSED_DIR = PODCAST_DIR / "audio_compressed"
TRANSCRIPTS_DIR = PODCAST_DIR / "transcripts"

MAX_PER_FIRE = 2


def load_index() -> List[Dict[str, Any]]:
    return json.loads(EPISODE_INDEX.read_text())


def save_index(items: List[Dict[str, Any]]) -> None:
    EPISODE_INDEX.write_text(json.dumps(items, indent=2, ensure_ascii=False))


def find_audio_file(entry: Dict[str, Any]) -> Optional[Path]:
    rel = entry.get("audio_path", "")
    if rel:
        for base in (PODCAST_DIR, AUDIO_DIR, AUDIO_COMPRESSED_DIR):
            candidate = base / rel
            if candidate.exists():
                return candidate
        # Also try the basename in either audio dir
        base_name = Path(rel).name
        for d in (AUDIO_DIR, AUDIO_COMPRESSED_DIR):
            candidate = d / base_name
            if candidate.exists():
                return candidate
    return None


def download_via_ytdlp(youtube_url: str, target_basename: str) -> Optional[Path]:
    """Download audio via yt-dlp if no local file exists."""
    if not shutil.which("yt-dlp"):
        return None
    target_path = AUDIO_DIR / f"{target_basename}.mp3"
    if target_path.exists():
        return target_path
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    cmd = [
        "yt-dlp", "-x", "--audio-format", "mp3",
        "--output", str(target_path.with_suffix(".%(ext)s")),
        youtube_url,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
        print(f"  yt-dlp failed for {youtube_url}: {e}", file=sys.stderr)
        return None
    return target_path if target_path.exists() else None


def transcript_target(entry: Dict[str, Any]) -> Path:
    rel = entry.get("transcript_path", "")
    if rel:
        return PODCAST_DIR / rel
    safe = entry.get("title", "untitled").replace("/", "_")[:80]
    return TRANSCRIPTS_DIR / f"{safe}.txt"


def process(limit: int = MAX_PER_FIRE) -> int:
    if not EPISODE_INDEX.exists():
        print(f"index missing: {EPISODE_INDEX}", file=sys.stderr)
        return 0
    index = load_index()
    n_done = 0
    for entry in index:
        if n_done >= limit:
            break
        if entry.get("transcribed") == "Yes":
            continue
        ep = entry.get("episode_number", "")
        title = entry.get("title", "")[:60]

        audio = find_audio_file(entry)
        if not audio:
            youtube = entry.get("youtube_url", "")
            if youtube:
                safe = entry.get("title", "untitled").replace("/", "_")[:80]
                print(f"[ingest] {ep}: no local audio, attempting yt-dlp download from {youtube}", file=sys.stderr)
                audio = download_via_ytdlp(youtube, safe)
            if not audio:
                print(f"[skip] {ep}: no audio available", file=sys.stderr)
                continue

        print(f"[ingest] {ep}: transcribing {audio.name} ({title})", file=sys.stderr)
        result = transcribe(audio, youtube_url=entry.get("youtube_url"))
        if not result or not result.get("text"):
            print(f"  failed", file=sys.stderr)
            continue

        transcript_path = transcript_target(entry)
        transcript_path.parent.mkdir(parents=True, exist_ok=True)
        transcript_path.write_text(result["text"], encoding="utf-8")

        # Update entry
        entry["transcribed"] = "Yes"
        if entry.get("duration") in (None, "", "0m"):
            dur = result.get("duration")
            if dur:
                hours, rem = divmod(int(dur), 3600)
                mins = rem // 60
                entry["duration"] = f"{hours}.0h {mins}.0m" if hours else f"{mins}m"
        save_index(index)
        n_done += 1
        time.sleep(5)  # pacing
    print(f"\nDone. Transcribed {n_done} episode(s).", file=sys.stderr)
    return n_done


if __name__ == "__main__":
    limit = MAX_PER_FIRE
    for arg in sys.argv[1:]:
        if arg.startswith("--limit="):
            limit = int(arg.split("=", 1)[1])
    process(limit=limit)
