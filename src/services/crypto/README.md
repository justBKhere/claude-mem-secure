# Crypto Services

Secure credential and database encryption management for claude-mem-secure.

## Overview

This module provides two main components:

1. **KeyringManager** - Cross-platform OS keyring integration for secure credential storage
2. **DatabaseEncryption** - SQLCipher key management with key rotation support

## Installation

The crypto module requires the `keytar` package for OS keyring access:

```bash
npm install keytar
# or
bun add keytar
```

**Note:** `keytar` is a native module that may require build tools on some platforms.

## KeyringManager

### Features

- Cross-platform OS keyring access (macOS Keychain, Windows Credential Vault, Linux Secret Service)
- Automatic fallback to environment variables on headless servers
- Support for multiple secret types
- Graceful error handling with detailed logging

### Supported Secret Keys

- `GEMINI_API_KEY` - Gemini API credentials
- `OPENROUTER_API_KEY` - OpenRouter API credentials
- `DB_ENCRYPTION_KEY` - Database encryption key
- `AUTH_TOKEN` - Authentication token

### Usage

```typescript
import { keyringManager } from './services/crypto';

// Store a secret
await keyringManager.setSecret('GEMINI_API_KEY', 'your-api-key-here');

// Retrieve a secret (checks keyring, then environment variables)
const apiKey = await keyringManager.getSecret('GEMINI_API_KEY');

// Check if a secret exists
const hasKey = await keyringManager.hasSecret('GEMINI_API_KEY');

// Delete a secret
await keyringManager.deleteSecret('GEMINI_API_KEY');

// List all available secrets
const secrets = await keyringManager.listSecrets();
```

### Fallback Behavior

When OS keyring is unavailable (headless servers, CI/CD, etc.):

1. `getSecret()` falls back to environment variables
2. `setSecret()` returns `false` and logs a warning
3. Secrets should be provided via environment variables instead

Example for headless servers:

```bash
export GEMINI_API_KEY="your-api-key"
export DB_ENCRYPTION_KEY="your-db-key"
```

## DatabaseEncryption

### Features

- Secure random key generation (256-bit)
- Automatic key storage in OS keyring
- Key rotation support with database re-encryption
- Key validation utilities

### Usage

```typescript
import { databaseEncryption } from './services/crypto';

// Get or create encryption key (auto-generates on first run)
const key = await databaseEncryption.getOrCreateEncryptionKey();

// Use with SQLCipher
// PRAGMA key = 'x'${key}';

// Check if key exists
const hasKey = await databaseEncryption.hasEncryptionKey();

// Rotate encryption key (returns old and new keys)
const { oldKey, newKey } = await databaseEncryption.rotateEncryptionKey();

// ... re-encrypt your database with newKey ...

// Confirm rotation after successful re-encryption
await databaseEncryption.confirmKeyRotation(newKey);

// Validate a key format
const isValid = databaseEncryption.validateKey(someKey);
```

### Key Rotation Process

```typescript
// 1. Get old and new keys
const { oldKey, newKey } = await databaseEncryption.rotateEncryptionKey();

// 2. Re-encrypt database (pseudo-code)
// ATTACH DATABASE 'encrypted.db' AS encrypted KEY 'x'${oldKey}';
// ATTACH DATABASE 'plaintext.db' AS plaintext KEY '';
// SELECT sqlcipher_export('plaintext');
// DETACH DATABASE encrypted;
// DETACH DATABASE plaintext;
// ATTACH DATABASE 'plaintext.db' AS reencrypted KEY 'x'${newKey}';
// SELECT sqlcipher_export('reencrypted');

// 3. Confirm rotation (updates stored key)
await databaseEncryption.confirmKeyRotation(newKey);
```

## Logging

All operations are logged using the existing `src/utils/logger.ts`:

- **INFO**: Key generation, storage, retrieval
- **WARN**: Keyring unavailable, fallback behavior
- **ERROR**: Operation failures
- **DEBUG**: Detailed operation traces

**Security Note:** Secret values are NEVER logged. Only key identifiers and operation results are logged.

## Security Considerations

1. **OS Keyring**: Primary storage mechanism, encrypted by OS
2. **Environment Variables**: Fallback for headless servers (less secure)
3. **Key Rotation**: Requires application coordination for database re-encryption
4. **Key Deletion**: Permanent - encrypted data becomes inaccessible

## Production Deployment

### With OS Keyring (Recommended)

```bash
# Install keytar
npm install keytar

# Keys stored automatically in OS keyring
```

### Headless Servers

```bash
# Set secrets via environment variables
export GEMINI_API_KEY="..."
export DB_ENCRYPTION_KEY="..."

# Application will use env vars automatically
```

### Docker/Containers

```bash
# Use Docker secrets or environment variables
docker run -e GEMINI_API_KEY="..." -e DB_ENCRYPTION_KEY="..." ...
```

## Error Handling

All methods handle errors gracefully:

- Operations return `false` or `null` on failure
- Errors are logged with context
- Keyring unavailability triggers automatic fallback

```typescript
// Safe error handling
const key = await keyringManager.getSecret('API_KEY');
if (!key) {
  console.error('API key not found - check keyring or environment');
  // Handle missing key
}
```

## Testing

```typescript
// Check if keyring is available
const isAvailable = await keyringManager.isKeytarAvailable();

if (isAvailable) {
  console.log('OS keyring is available');
} else {
  console.log('Using environment variable fallback');
}
```

## API Reference

### KeyringManager

- `setSecret(key, value): Promise<boolean>` - Store a secret
- `getSecret(key): Promise<string | null>` - Retrieve a secret
- `deleteSecret(key): Promise<boolean>` - Delete a secret
- `hasSecret(key): Promise<boolean>` - Check if secret exists
- `isKeytarAvailable(): Promise<boolean>` - Check keyring availability
- `listSecrets(): Promise<SecretKey[]>` - List all stored secrets

### DatabaseEncryption

- `getOrCreateEncryptionKey(): Promise<string>` - Get or generate key
- `rotateEncryptionKey(): Promise<{oldKey, newKey}>` - Initiate rotation
- `confirmKeyRotation(newKey): Promise<boolean>` - Complete rotation
- `deleteEncryptionKey(): Promise<boolean>` - Delete key (WARNING: permanent)
- `hasEncryptionKey(): Promise<boolean>` - Check if key exists
- `validateKey(key): boolean` - Validate key format

## License

AGPL-3.0 (same as claude-mem)
