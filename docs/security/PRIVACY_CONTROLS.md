# Privacy Controls in claude-mem

This document describes the enhanced privacy controls available in claude-mem.

## Overview

Claude-mem provides multiple layers of privacy protection to prevent sensitive information from being stored in memory:

1. **Tag-based privacy controls** - Manual tags you can wrap around sensitive content
2. **Automatic secret redaction** - Pattern-based detection of common secrets
3. **Custom redaction patterns** - User-configurable regex patterns

## Tag-based Privacy Controls

### 1. `<private>` Tag - Content Removal

Use `<private>` tags to completely remove content from memory storage:

```
Please help me with this code <private>using my password: secretpass123</private>
```

Result stored in memory:
```
Please help me with this code
```

The content inside `<private>` tags is **completely removed** before storage.

### 2. `<secret>` Tag - Content Redaction

Use `<secret>` tags to replace sensitive content with `[REDACTED]`:

```
My API key is <secret>sk-123abc456def</secret> for the OpenAI service
```

Result stored in memory:
```
My API key is [REDACTED] for the OpenAI service
```

The content inside `<secret>` tags is **replaced with [REDACTED]**, preserving the context while hiding the sensitive value.

### 3. `<claude-mem-context>` Tag - System Tag

This is a system-level tag used internally by claude-mem to prevent recursive storage of auto-injected observations. You typically don't need to use this tag manually.

## Automatic Secret Redaction

Even without explicit tags, claude-mem automatically detects and redacts common secret patterns:

### API Keys
- OpenAI-style: `sk-1234567890abcdefghij...`
- Generic: `api_1234567890abcdefghij...`
- Key prefix: `key_1234567890abcdefghij...`

Example:
```
Input:  "Use API key sk-abc123def456ghi789jkl012 for testing"
Stored: "Use API key [REDACTED] for testing"
```

### Bearer Tokens
```
Input:  "Authorization: Bearer abc123.def456.xyz789"
Stored: "Authorization: [REDACTED]"
```

### AWS Credentials
- Access Key IDs: `AKIAIOSFODNN7EXAMPLE`
- Secret Access Keys (with context)

### Private Keys (PEM Format)
```
Input:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----

Stored: [REDACTED]
```

### Password Patterns
- `password=mysecret`
- `passwd: mysecret`
- `pwd="mysecret"`

### JWT Tokens
```
Input:  "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0..."
Stored: "Token: [REDACTED]"
```

### GitHub Tokens
- Personal access tokens: `ghp_...`
- OAuth tokens: `gho_...`
- User tokens: `ghu_...`
- Server tokens: `ghs_...`
- Refresh tokens: `ghr_...`

### Generic Secrets
- `token=abc123...`
- `secret: "mysecret..."`
- `auth: "credentials..."`

## Custom Redaction Patterns

You can extend the automatic redaction with your own regex patterns.

### Configuration

Add custom patterns to your `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_REDACT_PATTERNS": "pattern1,pattern2,pattern3"
}
```

Patterns should be:
- Comma-separated
- Valid JavaScript regex patterns
- Under 200 characters each (ReDoS protection)
- Maximum 50 custom patterns

### Example

To redact custom database connection strings:

```json
{
  "CLAUDE_MEM_REDACT_PATTERNS": "mongodb://[^\\s]+,postgres://[^\\s]+,mysql://[^\\s]+"
}
```

This will redact:
```
Input:  "Connect to mongodb://user:pass@localhost:27017/db"
Stored: "Connect to [REDACTED]"
```

## Security Features

### 1. ReDoS Protection

The system includes multiple protections against Regular Expression Denial of Service attacks:

- **Tag count limits**: Maximum 100 tags per content block
- **Pattern length limits**: Custom patterns limited to 200 characters
- **Pattern count limits**: Maximum 50 custom patterns
- **Input validation**: Malformed patterns are skipped with warnings

### 2. No Secret Logging

The redaction system **never logs the original content** containing secrets. Only metadata is logged:

```json
{
  "message": "secrets redacted from content",
  "redactionCount": 3,
  "contentLength": 1234
}
```

### 3. Safe Pattern Compilation

User-provided regex patterns are:
- Validated before compilation
- Wrapped in try-catch blocks
- Logged if invalid (without exposing sensitive data)
- Skipped if they fail validation

## API Reference

### `redactSecrets(content: string)`

Manually redact secrets from content.

```typescript
import { redactSecrets } from './src/utils/tag-stripping.js';

const { redacted, count } = redactSecrets('API key: sk-abc123def456');
// redacted: "API key: [REDACTED]"
// count: 1
```

**Returns:**
- `redacted`: String with secrets replaced by `[REDACTED]`
- `count`: Number of secrets that were redacted

### `stripMemoryTagsFromPrompt(content: string)`

Process user prompts with full privacy controls (tags + automatic redaction).

```typescript
import { stripMemoryTagsFromPrompt } from './src/utils/tag-stripping.js';

const result = stripMemoryTagsFromPrompt(
  'Help me with <private>secret</private> and sk-abc123def456'
);
// result: "Help me with  and [REDACTED]"
```

### `stripMemoryTagsFromJson(content: string)`

Process JSON-serialized tool inputs/responses with privacy controls.

```typescript
import { stripMemoryTagsFromJson } from './src/utils/tag-stripping.js';

const result = stripMemoryTagsFromJson(
  JSON.stringify({ key: 'sk-abc123def456' })
);
// Secrets redacted in stringified JSON
```

## Best Practices

1. **Use `<private>` for personal information** you don't want stored at all
2. **Use `<secret>` for credentials** where context matters but value should be hidden
3. **Rely on automatic redaction** for common secret formats
4. **Add custom patterns** for domain-specific secrets (DB URLs, internal tokens, etc.)
5. **Test your patterns** before deploying to ensure they work as expected

## Examples

### Example 1: Code Review with Credentials

```
Please review this code:

<private>
// My personal notes - don't store these
// TODO: Refactor the authentication logic
</private>

const config = {
  apiKey: <secret>sk-proj-abc123def456</secret>,
  endpoint: "https://api.example.com"
};

// The password variable is automatically redacted
const dbUrl = "postgres://user:password123@localhost/db";
```

Stored as:
```
Please review this code:

const config = {
  apiKey: [REDACTED],
  endpoint: "https://api.example.com"
};

// The [REDACTED] variable is automatically redacted
const dbUrl = "[REDACTED]";
```

### Example 2: Configuration Help

```
I need help with my API configuration.
My key is <secret>sk-abc123</secret> and the endpoint is api.service.com
```

Stored as:
```
I need help with my API configuration.
My key is [REDACTED] and the endpoint is api.service.com
```

### Example 3: Troubleshooting

```
I'm getting an error with Bearer token authentication.
Here's my request header:
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Stored as:
```
I'm getting an error with [REDACTED] authentication.
Here's my request header:
Authorization: [REDACTED]
```

## Troubleshooting

### Secrets Not Being Redacted

1. Check if your secret matches one of the default patterns
2. Add a custom pattern in `CLAUDE_MEM_REDACT_PATTERNS`
3. Use explicit `<secret>` tags as a fallback

### Custom Pattern Not Working

1. Verify the regex syntax is valid JavaScript
2. Check pattern length (must be < 200 characters)
3. Check logs for validation errors: `~/.claude-mem/logs/`
4. Ensure pattern includes the `g` flag for global matching (automatically added)

### Performance Issues

1. Reduce number of custom patterns
2. Simplify complex regex patterns
3. Use more specific patterns (avoid overly broad matches)

## Implementation Details

The privacy controls are implemented in `/home/exedev/claude-mem/src/utils/tag-stripping.ts` with comprehensive test coverage in `/home/exedev/claude-mem/tests/utils/tag-stripping.test.ts`.

Key features:
- Edge processing pattern: Filtering happens at hook layer before worker/storage
- DRY principle: Shared `stripTagsInternal()` function
- Defensive programming: Handles malformed input gracefully
- Security-first: Never logs original sensitive content
