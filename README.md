# claude-mem-secure

**Persistent memory for Claude Code with enhanced security**

A security-hardened fork of [claude-mem](https://github.com/thedotmack/claude-mem) by [@thedotmack](https://github.com/thedotmack).

## Quick Install

```bash
git clone https://github.com/justBKhere/claude-mem-secure.git
cd claude-mem-secure
./setup.sh
```

Then restart Claude Code. That's it!

## Setup with Claude

Just tell Claude:

> "Set up claude-mem-secure from this repo"

Claude will read `SETUP.md` and configure everything automatically.

## What It Does

Claude-mem automatically captures your coding sessions and makes context available to future sessions:

- **Captures** tool usage, file changes, decisions made
- **Compresses** observations using AI to extract key insights
- **Injects** relevant context into future sessions automatically
- **Searches** your memory with natural language queries

## Security Improvements

This fork adds significant security hardening:

| Feature | Original | This Fork |
|---------|----------|-----------|
| **API Key Storage** | Plaintext in settings.json | OS Keyring + file fallback |
| **Database** | Unencrypted SQLite | SQLCipher encryption ready |
| **API Access** | No authentication | Token-based authentication |
| **File Permissions** | Default (world-readable) | 600 (owner only) |
| **Data Retention** | Forever | Configurable (default 90 days) |
| **Secret Detection** | `<private>` tags only | Automatic pattern redaction |

### Security Features

**1. Token-Based Authentication**
- Auto-generated secure token on first run
- Stored in `~/.claude-mem/.auth-token` (mode 600)
- All sensitive endpoints require Bearer token

**2. Automatic Secret Redaction**
- Detects and redacts API keys, tokens, passwords
- `<secret>` tags for explicit redaction
- Custom patterns via `CLAUDE_MEM_REDACT_PATTERNS`

**3. Data Retention**
- Configurable retention period (default 90 days)
- Optional archiving before deletion
- Settings in `~/.claude-mem/settings.json`

**4. OS Keyring Integration**
- API keys stored in macOS Keychain, Linux libsecret, or Windows Credential Manager
- Falls back to secure file storage on headless systems

## Configuration

Settings are stored in `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_RETENTION_ENABLED": "true",
  "CLAUDE_MEM_RETENTION_DAYS": "90",
  "CLAUDE_MEM_ARCHIVE_BEFORE_DELETE": "true"
}
```

## Usage

### View Memory UI
```bash
open http://127.0.0.1:37777
```

### Get Auth Token
```bash
cat ~/.claude-mem/.auth-token
```

### Privacy Tags

Exclude content from memory:
```
<private>This won't be stored</private>
```

Redact but keep context:
```
My API key is <secret>sk-abc123</secret>
# Stored as: My API key is [REDACTED]
```

## Requirements

- Node.js 18+ or Bun
- Claude Code CLI

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude-mem/` | Data directory |
| `~/.claude-mem/claude-mem.db` | SQLite database |
| `~/.claude-mem/settings.json` | Configuration |
| `~/.claude-mem/.auth-token` | Auth token (headless) |
| `~/.claude-mem/logs/` | Log files |
| `~/.claude/settings.json` | Claude Code hooks |

## Credits

- Original [claude-mem](https://github.com/thedotmack/claude-mem) by [Alex Newman (@thedotmack)](https://github.com/thedotmack)
- Security improvements by the community

## License

AGPL-3.0 - Same as the original project.

This is a fork with security improvements. The original copyright belongs to Alex Newman.
See [LICENSE](LICENSE) for full terms.

## Changes from Original

**Added:**
- `src/services/crypto/` - KeyringManager, DatabaseEncryption
- `src/services/auth/` - TokenAuth for API authentication
- `src/services/retention/` - Configurable data retention
- `src/utils/file-permissions.ts` - File permission hardening
- Enhanced `src/utils/tag-stripping.ts` - Automatic secret redaction
- `setup.sh` - One-command installation
- `SETUP.md` - Claude-friendly setup instructions

**Removed:**
- `ragtime/` directory (different license - PolyForm Noncommercial)
