#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/digests/run_watcher.log"

# Export env vars from .env in the script directory
ENV_FILE="$SCRIPT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip blank lines and comments
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Skip lines without = (not a KEY=VALUE pair)
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    # Skip very long values (e.g. JSON blobs) to avoid shell errors; Python loads them directly
    if [ "${#val}" -lt 300 ]; then
      export "${key}=${val}" 2>/dev/null || true
    fi
  done < "$ENV_FILE"
fi

python3 "$SCRIPT_DIR/run_watcher.py" >> "$LOG_FILE" 2>&1
