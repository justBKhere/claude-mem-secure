#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

# Ensure data directory exists
mkdir -p ~/.claude-mem/logs

# Load or generate AUTH_TOKEN for headless systems
TOKEN_FILE="$HOME/.claude-mem/.auth-token"
if [ -z "$AUTH_TOKEN" ]; then
    if [ -f "$TOKEN_FILE" ]; then
        export AUTH_TOKEN=$(cat "$TOKEN_FILE")
    else
        # Generate a secure random token
        export AUTH_TOKEN=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
        echo "$AUTH_TOKEN" > "$TOKEN_FILE"
        chmod 600 "$TOKEN_FILE"
    fi
fi

# Add bun to PATH if installed
export PATH="$HOME/.bun/bin:$PATH"

# Start worker if not running
if ! curl -s http://127.0.0.1:37777/api/health > /dev/null 2>&1; then
    if command -v bun &> /dev/null; then
        AUTH_TOKEN="$AUTH_TOKEN" nohup bun run src/services/worker-service.ts > ~/.claude-mem/logs/worker.log 2>&1 &
    else
        AUTH_TOKEN="$AUTH_TOKEN" nohup node dist/services/worker-service.js > ~/.claude-mem/logs/worker.log 2>&1 &
    fi
    sleep 2
fi
