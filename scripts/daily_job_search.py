#!/usr/bin/env python3
import os
import signal
import sys
from pathlib import Path

# Load .env from the scripts directory so launchd runs work without the shell wrapper
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path, override=False)


def _install_watchdog() -> None:
    """Hard kill the run if it exceeds the deadline.

    Per-request timeouts in requests.get reset on every byte received, so a
    drip-feeding LinkedIn endpoint can keep a single call open indefinitely
    without tripping the deadline. SIGALRM provides a process-wide ceiling.
    """
    deadline = int(os.getenv("JOB_DIGEST_RUN_DEADLINE_SECONDS", "900") or "900")
    if deadline <= 0:
        return

    def _on_timeout(signum, frame):  # noqa: ARG001
        print(
            f"[watchdog] Run exceeded {deadline}s deadline; aborting to free launchd slot.",
            file=sys.stderr,
        )
        os._exit(124)

    signal.signal(signal.SIGALRM, _on_timeout)
    signal.alarm(deadline)


_install_watchdog()

from job_digest.company_coverage import sync_generated_targets

sync_generated_targets()

from job_digest.runner import cli


if __name__ == "__main__":
    cli()
