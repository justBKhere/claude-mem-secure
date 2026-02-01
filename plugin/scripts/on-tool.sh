#!/usr/bin/env bash
curl -s -X POST http://127.0.0.1:37777/api/sessions/observation \
    -H "Content-Type: application/json" \
    -d "$(cat)" > /dev/null 2>&1 || true
