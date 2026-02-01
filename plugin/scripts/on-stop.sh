#!/usr/bin/env bash
curl -s -X POST http://127.0.0.1:37777/api/sessions/summarize \
    -H "Content-Type: application/json" > /dev/null 2>&1 || true
