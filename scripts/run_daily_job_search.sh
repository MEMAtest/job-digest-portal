#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/digests/daily_job_search.log"

load_env_file() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments.
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local val="${line#*=}"

    # Skip very long values, such as JSON service accounts. Python loads those directly.
    if [ "${#val}" -lt 300 ]; then
      val="${val%\"}"
      val="${val#\"}"
      export "${key}=${val}" 2>/dev/null || true
    fi
  done < "$env_file"
}

# Load shared email/runtime settings first, then repo-local scraper settings.
load_env_file "$HOME/.job_digest.env"
load_env_file "$SCRIPT_DIR/.env"

python3 "$SCRIPT_DIR/daily_job_search.py" "$@" >> "$LOG_FILE" 2>&1
