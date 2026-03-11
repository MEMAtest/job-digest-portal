#!/usr/bin/env python3
import os
from pathlib import Path

# Load .env from the scripts directory so launchd runs work without the shell wrapper
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    from dotenv import load_dotenv
    load_dotenv(_env_path, override=False)

from job_digest.company_coverage import sync_generated_targets

sync_generated_targets()

from job_digest.runner import cli


if __name__ == "__main__":
    cli()
