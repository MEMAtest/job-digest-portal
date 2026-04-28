#!/usr/bin/env python3
"""Polls Firestore run_requests/latest. If status=="pending", fires daily_job_search.py."""
import base64, json, os, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

def _load_env_defaults() -> None:
    """Load scheduler defaults for both Firestore polling and digest email sends."""
    env_paths = [
        Path.home() / ".job_digest.env",
        Path(__file__).parent / ".env",
    ]
    for env_path in env_paths:
        if not env_path.exists():
            continue
        try:
            lines = env_path.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        for line in lines:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
_load_env_defaults()

import firebase_admin
from firebase_admin import credentials, firestore

SA_JSON = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "")
SA_B64  = os.getenv("FIREBASE_SERVICE_ACCOUNT_B64", "")
RUN_COL = os.getenv("FIREBASE_RUN_REQUESTS_COLLECTION", "run_requests")
SCRIPT  = Path(__file__).parent / "daily_job_search.py"

def get_client():
    data = json.loads(SA_JSON) if SA_JSON else json.loads(base64.b64decode(SA_B64).decode())
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(data))
    return firestore.client()

def main():
    try:
        client = get_client()
    except Exception as e:
        print(f"Firestore init failed: {e}"); sys.exit(1)

    ref = client.collection(RUN_COL).document("latest")
    try:
        doc = ref.get(timeout=10)
    except Exception as e:
        print(f"Firestore poll skipped: {e}")
        return
    if not doc.exists or doc.to_dict().get("status") != "pending":
        return  # nothing to do

    try:
        ref.update({"status": "running", "started_at": datetime.now(timezone.utc).isoformat()}, timeout=10)
    except Exception as e:
        print(f"Firestore status update failed before run: {e}")
        return

    LOG_PATH = Path(__file__).parent / "digests" / "daily_job_search_forced.log"
    LOG_PATH.parent.mkdir(exist_ok=True)

    with LOG_PATH.open("a") as log_fh:
        log_fh.write(f"\n--- run_watcher triggered at {datetime.now(timezone.utc).isoformat()} ---\n")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--skip-enrichment", "--skip-post-hooks"],
            env={**os.environ, "JOB_DIGEST_FORCE_RUN": "true"},
            stdout=log_fh,
            stderr=subprocess.STDOUT,
            text=True,
        )

    # Read last 20 lines for error reporting
    try:
        lines = LOG_PATH.read_text().splitlines()
        tail = "\n".join(lines[-20:])
    except Exception:
        tail = ""

    update_payload = {
        "status": "done" if result.returncode == 0 else "error",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "exit_code": result.returncode,
    }
    if result.returncode != 0:
        update_payload["error_tail"] = tail

    try:
        ref.update(update_payload, timeout=10)
    except Exception as e:
        print(f"Firestore status update failed after run: {e}")
    print(f"Run complete: exit {result.returncode}")

if __name__ == "__main__":
    main()
