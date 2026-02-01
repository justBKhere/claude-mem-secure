# Privacy Controls - Quick Reference

## Tag Usage

### Remove Content Entirely
```
<private>This content will be removed</private>
```

### Redact Sensitive Values
```
<secret>sk-abc123def456</secret>
```

## Automatic Redaction

These patterns are automatically redacted to `[REDACTED]`:

| Type | Pattern Example |
|------|----------------|
| OpenAI Keys | `sk-abc123...` |
| API Keys | `api_abc123...` |
| Generic Keys | `key_abc123...` |
| Bearer Tokens | `Bearer abc.xyz.123` |
| AWS Keys | `AKIAIOSFODNN7EXAMPLE` |
| GitHub Tokens | `ghp_abc123...` |
| JWT Tokens | `eyJhbGci...` |
| Private Keys | `-----BEGIN PRIVATE KEY-----` |
| Passwords | `password=secret` |
| Passwords | `passwd: secret` |
| Tokens | `token=abc123...` |
| Secrets | `secret: "value"` |

## Custom Patterns

Add to `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_REDACT_PATTERNS": "mongodb://[^\\s]+,postgres://[^\\s]+"
}
```

## Examples

### Before Processing
```
My API key is sk-abc123def456 and password=secret123
```

### After Processing
```
My API key is [REDACTED] and [REDACTED]
```

## Limits

- Max custom patterns: 50
- Max pattern length: 200 characters
- Max tags per content: 100

## API

```typescript
import { redactSecrets } from './src/utils/tag-stripping.js';

const { redacted, count } = redactSecrets('sk-abc123');
// redacted: "[REDACTED]"
// count: 1
```

## Documentation

Full documentation: `/home/exedev/claude-mem/PRIVACY_CONTROLS.md`
