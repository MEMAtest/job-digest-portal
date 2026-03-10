#!/usr/bin/env python3
from job_digest.company_coverage import sync_generated_targets

sync_generated_targets()

from job_digest.runner import cli


if __name__ == "__main__":
    cli()
