#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
curl -s -X POST http://127.0.0.1:37777/api/sessions/init \
    -H "Content-Type: application/json" \
    -d "{\"prompt\": \"$(cat)\"}" > /dev/null 2>&1 || true
