# Claude Setup Instructions

> **For Claude**: When a user asks you to set up claude-mem-secure, follow these steps exactly.

## Quick Setup (One Command)

```bash
./setup.sh
```

If that fails, follow the manual steps below.

## Manual Setup Steps

### 1. Install Bun (if not installed)

```bash
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
```

### 2. Install Dependencies

```bash
cd /path/to/claude-mem-secure
bun install
```

### 3. Build the Project

```bash
bun run build
```

### 4. Create Data Directory

```bash
mkdir -p ~/.claude-mem/logs
chmod 700 ~/.claude-mem
```

### 5. Configure Claude Code Hooks

Create or update `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun /path/to/claude-mem-secure/plugin/scripts/worker-service.cjs start"
          },
          {
            "type": "command",
            "command": "bun /path/to/claude-mem-secure/plugin/scripts/worker-service.cjs hook claude-code context"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun /path/to/claude-mem-secure/plugin/scripts/worker-service.cjs hook claude-code session-init"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun /path/to/claude-mem-secure/plugin/scripts/worker-service.cjs hook claude-code observation"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun /path/to/claude-mem-secure/plugin/scripts/worker-service.cjs hook claude-code summarize"
          }
        ]
      }
    ]
  }
}
```

**Important**: Replace `/path/to/claude-mem-secure` with the actual path where the repo is cloned, and ensure `bun` is in your PATH (or use the full path like `/home/user/.bun/bin/bun`).

### 6. Restart Claude Code

The user needs to restart Claude Code (or start a new session) for hooks to activate.

## Verification

After restart, verify the worker is running:

```bash
curl http://127.0.0.1:37777/api/health
```

Expected response: `{"status":"ok",...}`

## Troubleshooting

### Worker not starting
- Check logs: `cat ~/.claude-mem/logs/worker.log`
- Verify Bun is in PATH: `which bun`

### Auth token issues
- Token is stored in `~/.claude-mem/.auth-token`
- To regenerate: delete the file and restart

### Hooks not working
- Verify paths in `~/.claude/settings.json` are correct
- Ensure scripts are executable

## Security Features Enabled

After setup, these security features are active:
- ✅ API authentication (token-based)
- ✅ Automatic secret redaction
- ✅ Data retention policies (90 days default)
- ✅ Secure file permissions

## View Memory

Open in browser: http://127.0.0.1:37777
