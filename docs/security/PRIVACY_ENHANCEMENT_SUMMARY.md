# Privacy Controls Enhancement Summary

## Overview

This document summarizes the privacy control enhancements made to the claude-mem project, adding comprehensive secret redaction capabilities.

## Changes Made

### 1. Updated `/home/exedev/claude-mem/src/utils/tag-stripping.ts`

#### Added New Tag Support: `<secret>`
- Content inside `<secret>` tags is replaced with `[REDACTED]` (not removed entirely like `<private>`)
- Preserves context while hiding sensitive values
- Example: `"API key: <secret>sk-123</secret>"` → `"API key: [REDACTED]"`

#### Added Automatic Secret Redaction
Implemented pattern-based detection for common secrets:

**API Keys:**
- OpenAI-style: `sk-[a-zA-Z0-9]{20,}`
- Generic with `api_` prefix
- Generic with `key_` prefix

**Authentication:**
- Bearer tokens (case insensitive)
- JWT tokens
- Generic token/secret/auth patterns

**Cloud Credentials:**
- AWS Access Key IDs: `AKIA[0-9A-Z]{16}`
- AWS Secret Access Keys (with context)

**Cryptographic Material:**
- Private keys in PEM format (RSA and generic)

**Passwords:**
- `password=...`, `passwd:...`, `pwd="..."`

**Version Control:**
- GitHub tokens: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`

#### Added Custom Pattern Support
- New setting: `CLAUDE_MEM_REDACT_PATTERNS` (comma-separated regex patterns)
- Users can extend redaction with domain-specific patterns
- Example: `"mongodb://[^\\s]+,postgres://[^\\s]+"`

#### Added Security Features

**ReDoS Protection:**
- Maximum pattern length: 200 characters
- Maximum custom patterns: 50
- Maximum tags per content block: 100
- Safe pattern compilation with error handling

**Security-First Design:**
- Never logs original content containing secrets
- Only logs metadata (redaction count, content length)
- Defensive error handling for malformed patterns

#### New Exported Function: `redactSecrets()`
```typescript
export function redactSecrets(content: string): { redacted: string; count: number }
```

Returns:
- `redacted`: Content with secrets replaced by `[REDACTED]`
- `count`: Number of redactions performed

#### Updated Existing Functions
- `stripMemoryTagsFromPrompt()` now calls `redactSecrets()` automatically
- `stripMemoryTagsFromJson()` now includes automatic redaction
- Both functions now handle `<secret>` tags

### 2. Updated `/home/exedev/claude-mem/src/shared/SettingsDefaultsManager.ts`

#### Added New Setting to Interface
```typescript
export interface SettingsDefaults {
  // ... existing settings ...
  // Privacy Controls
  CLAUDE_MEM_REDACT_PATTERNS: string;
}
```

#### Added Default Value
```typescript
CLAUDE_MEM_REDACT_PATTERNS: '', // Empty means no custom patterns
```

### 3. Updated `/home/exedev/claude-mem/tests/utils/tag-stripping.test.ts`

Added comprehensive test coverage for new features:

#### Secret Tag Tests (6 tests)
- Basic `<secret>` tag replacement
- Multiple secret tags
- Multiline content in secret tags
- Mixed `<private>` and `<secret>` tags
- Empty secret tags

#### `redactSecrets()` Function Tests (50+ tests)
Organized into categories:
- OpenAI API keys
- Generic API keys (api_, key_ prefixes)
- Bearer tokens (case insensitive)
- AWS credentials
- Private keys (RSA and generic)
- Password patterns
- JWT tokens
- GitHub tokens
- Generic secrets (token=, secret:, auth:)
- Edge cases (empty, null, undefined)
- Performance tests
- Security tests (verify no logging of secrets)

#### Integration Tests (4 tests)
- Automatic redaction in `stripMemoryTagsFromPrompt()`
- Combined tag stripping and automatic redaction
- Secret tags + pattern-matched secrets
- No double-redaction of existing `[REDACTED]`

### 4. Created `/home/exedev/claude-mem/PRIVACY_CONTROLS.md`

Comprehensive user documentation covering:
- Overview of privacy features
- Tag-based controls (`<private>`, `<secret>`, `<claude-mem-context>`)
- Automatic secret redaction patterns
- Custom redaction configuration
- Security features
- API reference
- Best practices
- Examples
- Troubleshooting guide

## Technical Implementation Details

### Architecture Decisions

1. **Edge Processing Pattern**: Filtering happens at hook layer before worker/storage
   - Keeps worker service simple
   - Follows one-way data flow
   - Prevents secrets from ever reaching storage

2. **DRY Principle**: Shared `stripTagsInternal()` function
   - Single source of truth for tag stripping logic
   - Used by both `stripMemoryTagsFromPrompt()` and `stripMemoryTagsFromJson()`

3. **Defense in Depth**:
   - Multiple layers: manual tags, automatic patterns, custom patterns
   - ReDoS protection at multiple levels
   - Safe pattern compilation with error handling
   - Never logs sensitive content

### Code Organization

```
src/utils/tag-stripping.ts
├── Constants
│   ├── MAX_TAG_COUNT (100)
│   ├── MAX_PATTERN_LENGTH (200)
│   ├── MAX_CUSTOM_PATTERNS (50)
│   └── DEFAULT_REDACTION_PATTERNS (array of RegExp)
├── Helper Functions
│   ├── countTags() - Tag counting for ReDoS protection
│   ├── compileUserPatterns() - Safe pattern compilation
│   └── getRedactionPatterns() - Load default + custom patterns
├── Public API
│   ├── redactSecrets() - NEW: Manual secret redaction
│   ├── stripMemoryTagsFromPrompt() - UPDATED: Now includes redaction
│   └── stripMemoryTagsFromJson() - UPDATED: Now includes redaction
└── Internal Functions
    └── stripTagsInternal() - UPDATED: Handles all three tag types + redaction
```

### Default Redaction Patterns

Total: 11 patterns covering common secret formats

1. OpenAI API keys: `sk-[a-zA-Z0-9]{20,}`
2. Generic API keys (api_): `api_[a-zA-Z0-9]{20,}`
3. Generic API keys (key_): `key_[a-zA-Z0-9]{20,}`
4. Bearer tokens: `Bearer\s+[a-zA-Z0-9\-._~+\/]+=*` (case insensitive)
5. AWS Access Keys: `AKIA[0-9A-Z]{16}`
6. AWS Secret Keys: `[A-Za-z0-9/+=]{40}` (with context)
7. Private keys: `-----BEGIN ... PRIVATE KEY-----...-----END ... PRIVATE KEY-----`
8. Passwords: `(password|passwd|pwd)\s*[=:]\s*['"]?...['"]?`
9. JWT tokens: `eyJ...\.eyJ...\....`
10. GitHub tokens: `gh[pousr]_[a-zA-Z0-9]{36,}`
11. Generic secrets: `(token|secret|auth)['"]?\s*[=:]\s*['"]?...['"]?`

## Testing

### Test Coverage

- **Total new tests**: 60+ tests
- **Test file**: `/home/exedev/claude-mem/tests/utils/tag-stripping.test.ts`
- **Coverage areas**:
  - Secret tag functionality
  - Pattern-based redaction for each secret type
  - Edge cases (empty, null, undefined)
  - Performance (large content, many secrets)
  - Security (no secret logging)
  - Integration (combined features)

### Running Tests

```bash
cd /home/exedev/claude-mem
bun test tests/utils/tag-stripping.test.ts
```

## Configuration

### User Configuration File

Location: `~/.claude-mem/settings.json`

Add custom patterns:
```json
{
  "CLAUDE_MEM_REDACT_PATTERNS": "pattern1,pattern2,pattern3"
}
```

### Example Custom Patterns

```json
{
  "CLAUDE_MEM_REDACT_PATTERNS": "mongodb://[^\\s]+,postgres://[^\\s]+,mysql://[^\\s]+,redis://[^\\s]+"
}
```

This redacts database connection strings across multiple database types.

## Security Considerations

### What's Protected

1. **Secrets never logged**: Original content with secrets is never written to logs
2. **ReDoS protection**: Multiple limits prevent regex denial of service
3. **Safe compilation**: Invalid patterns are skipped, not executed
4. **Fail-safe design**: Errors in redaction don't crash the system

### What's Not Protected

1. **Secrets in file paths**: Redaction only applies to content, not file paths
2. **Obfuscated secrets**: Only detects common formats, not encoded/obfuscated secrets
3. **Novel formats**: Custom secret formats require user-defined patterns

### Best Practices

1. Use explicit `<secret>` tags for important secrets
2. Add custom patterns for domain-specific secrets
3. Test patterns before relying on them
4. Use `<private>` tags for content you don't want stored at all
5. Review stored observations periodically to ensure redaction is working

## Performance Impact

### Benchmarks

- Large content (1000 lines): < 1 second processing time
- Multiple secrets (10+ matches): Minimal overhead
- Pattern compilation: Cached after first use
- Tag counting: O(n) linear scan

### Optimization Strategies

1. Default patterns are pre-compiled
2. Settings are loaded once and cached
3. Regex patterns use lazy quantifiers where appropriate
4. Pattern count limited to prevent excessive iterations

## Migration Guide

### For Existing Users

No migration required. The new features are backward compatible:

1. Existing `<private>` and `<claude-mem-context>` tags work as before
2. Automatic redaction happens transparently
3. No settings need to be changed
4. Existing stored data is not affected

### For New Users

1. Install/update claude-mem
2. (Optional) Add custom patterns to `~/.claude-mem/settings.json`
3. Use `<secret>` tags for sensitive data in prompts
4. Rely on automatic redaction for common secrets

## Future Enhancements

Potential future improvements:

1. **Pattern library**: Curated list of patterns for common frameworks/services
2. **Secret detection ML**: Machine learning-based secret detection
3. **Whitelist support**: Allow certain patterns to bypass redaction
4. **Audit logging**: Separate log of redaction events for security auditing
5. **UI for pattern management**: Visual interface for managing custom patterns
6. **Pattern testing tool**: CLI tool to test patterns before deployment

## Dependencies

No new dependencies added. Uses only Node.js built-in modules:
- `fs` (file system)
- `path` (path manipulation)
- `os` (homedir)

Integrates with existing claude-mem infrastructure:
- `logger` for structured logging
- `SettingsDefaultsManager` for configuration

## Backward Compatibility

✅ **Fully backward compatible**

- No breaking changes to existing APIs
- All existing tests pass
- New features are additive only
- Settings have sensible defaults (empty custom patterns)

## Summary of Files Modified

1. **`/home/exedev/claude-mem/src/utils/tag-stripping.ts`**
   - Added 100+ lines of new code
   - New constants, functions, and pattern definitions
   - Enhanced existing functions

2. **`/home/exedev/claude-mem/src/shared/SettingsDefaultsManager.ts`**
   - Added 1 new setting to interface
   - Added 1 new default value

3. **`/home/exedev/claude-mem/tests/utils/tag-stripping.test.ts`**
   - Added 60+ new test cases
   - Added 3 new test suites

4. **`/home/exedev/claude-mem/PRIVACY_CONTROLS.md`** (NEW)
   - Comprehensive user documentation

5. **`/home/exedev/claude-mem/PRIVACY_ENHANCEMENT_SUMMARY.md`** (NEW)
   - This technical summary document

## Verification Checklist

- [x] `<secret>` tag support implemented
- [x] Pattern-based automatic redaction implemented
- [x] Custom pattern configuration support added
- [x] ReDoS protection implemented
- [x] Comprehensive test coverage added
- [x] No secret logging (security verified)
- [x] Settings interface updated
- [x] Default settings added
- [x] User documentation created
- [x] Technical summary created
- [x] Backward compatibility maintained
- [x] No new dependencies added

## Contact

For questions or issues related to this enhancement, please refer to:
- User documentation: `/home/exedev/claude-mem/PRIVACY_CONTROLS.md`
- Test suite: `/home/exedev/claude-mem/tests/utils/tag-stripping.test.ts`
- Implementation: `/home/exedev/claude-mem/src/utils/tag-stripping.ts`
