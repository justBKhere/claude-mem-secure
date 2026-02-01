# Database Encryption Implementation

This document describes the database encryption infrastructure for claude-mem.

## Overview

The encryption implementation provides a foundation for SQLCipher database encryption while maintaining compatibility with the current bun:sqlite runtime. It's designed to be modular and ready for future migration to better-sqlite3 with SQLCipher support.

## Architecture

### Key Components

1. **DatabaseEncryption** (`src/services/crypto/DatabaseEncryption.ts`)
   - Manages encryption keys using OS keyring via KeyringManager
   - Generates secure 256-bit encryption keys
   - Supports key rotation and validation

2. **EncryptionMigration** (`src/services/sqlite/EncryptionMigration.ts`)
   - Provides utilities for migrating between encrypted and unencrypted databases
   - Exports/imports all data during migration
   - Designed for future SQLCipher integration

3. **Database Classes** (`src/services/sqlite/Database.ts`)
   - `ClaudeMemDatabase` - Main database class with encryption support
   - `DatabaseManager` - Legacy singleton with encryption support
   - Both classes support encryption initialization and status checking

4. **Path Constants** (`src/shared/paths.ts`)
   - `DB_PATH` - Standard unencrypted database path
   - `ENCRYPTED_DB_PATH` - Encrypted database path
   - `DB_ENCRYPTION_ENABLED_PATH` - Flag file to enable encryption

## Current Limitations

Since bun:sqlite doesn't have built-in SQLCipher support, the current implementation:

1. **Stores encryption metadata** in a special `_encryption_metadata` table
2. **Manages encryption keys** securely via the keyring
3. **Marks databases for encryption** using metadata flags
4. **Prepares migration utilities** for when SQLCipher becomes available

The actual encryption of database contents will be implemented when the project migrates to better-sqlite3 with SQLCipher support.

## Usage

### Basic Initialization

```typescript
import { ClaudeMemDatabase } from './services/sqlite/Database.js';

// Create database instance
const db = new ClaudeMemDatabase();

// Initialize with encryption support
const success = await db.initializeWithEncryption();

if (success) {
  console.log('Encryption initialized');
  console.log('Is encrypted:', db.isEncrypted());
}
```

### Checking Encryption Status

```typescript
import { isDatabaseMarkedEncrypted } from './services/sqlite/EncryptionMigration.js';
import { DB_PATH } from './shared/paths.js';

// Check if database is marked for encryption
const isEncrypted = isDatabaseMarkedEncrypted(DB_PATH);
console.log('Database encrypted:', isEncrypted);
```

### Manual Encryption Migration (Future)

```typescript
import { migrateToEncrypted } from './services/sqlite/EncryptionMigration.js';
import { DB_PATH, ENCRYPTED_DB_PATH } from './shared/paths.js';
import { databaseEncryption } from './services/crypto/DatabaseEncryption.js';

// Get or create encryption key
const encryptionKey = await databaseEncryption.getOrCreateEncryptionKey();

// Migrate to encrypted database
const result = await migrateToEncrypted(
  DB_PATH,
  ENCRYPTED_DB_PATH,
  encryptionKey
);

if (result.success) {
  console.log(`Migrated ${result.recordsMigrated} records`);
  console.log(`Processed ${result.tablesProcessed.length} tables`);
  console.log(`Backup at: ${result.backupPath}`);
} else {
  console.error('Migration failed:', result.error);
}
```

### Using ClaudeMemDatabase with Encryption

```typescript
import { ClaudeMemDatabase } from './services/sqlite/Database.js';

// Create database with default path
const db = new ClaudeMemDatabase();

// Initialize encryption
await db.initializeWithEncryption();

// Check encryption status
if (db.isEncrypted()) {
  console.log('Database is encrypted');

  // Get encryption key (if needed for operations)
  const key = db.getEncryptionKey();
}

// Use database normally
db.db.run('SELECT * FROM sessions');

// Close when done
db.close();
```

### Enabling Encryption

To enable encryption for a new or existing database:

1. **Create the encryption flag file**:
   ```bash
   echo "true" > ~/.claude-mem/.encryption-enabled
   ```

2. **Initialize the database**:
   ```typescript
   const db = new ClaudeMemDatabase();
   await db.initializeWithEncryption();
   ```

3. The database will be marked for encryption and an encryption key will be generated and stored in the OS keyring.

## Migration Path to SQLCipher

When migrating to better-sqlite3 with SQLCipher:

1. **Update dependencies**: Replace `bun:sqlite` with `better-sqlite3` compiled with SQLCipher
2. **Enable PRAGMA key**: In `EncryptionMigration.ts`, uncomment the SQLCipher PRAGMA statements
3. **Test migration**: Use `migrateToEncrypted()` to migrate existing databases
4. **Update documentation**: Remove "pending_sqlcipher" references

## Security Considerations

### Current Implementation

- **Encryption keys** are stored in the OS keyring (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Key generation** uses `crypto.randomBytes()` for cryptographically secure randomness
- **Key validation** ensures proper format (64-character hex string for 256-bit key)
- **Metadata tables** mark databases as encrypted but don't encrypt the contents yet

### Future (with SQLCipher)

- **AES-256 encryption** for all database pages
- **PBKDF2 key derivation** with configurable iterations
- **Page-level encryption** with authenticated encryption
- **Zero plaintext** on disk after migration

## File Locations

- **Standard database**: `~/.claude-mem/claude-mem.db`
- **Encrypted database**: `~/.claude-mem/claude-mem.encrypted.db`
- **Encryption flag**: `~/.claude-mem/.encryption-enabled`
- **Encryption key**: Stored in OS keyring as `DB_ENCRYPTION_KEY`

## API Reference

### ClaudeMemDatabase

#### `async initializeWithEncryption(): Promise<boolean>`
Initialize database with encryption support. Creates encryption metadata and stores encryption key.

**Returns**: `true` if successful, `false` otherwise

#### `isEncrypted(): boolean`
Check if database is marked as encrypted.

**Returns**: `true` if database has encryption metadata, `false` otherwise

#### `getEncryptionKey(): string | null`
Get the encryption key (if available).

**Returns**: Hex-encoded encryption key or `null` if not initialized

#### `async migrateToEncrypted(): Promise<boolean>`
Migrate current database to encrypted format.

**Returns**: `true` if migration successful, `false` otherwise

### DatabaseEncryption

#### `async getOrCreateEncryptionKey(): Promise<string>`
Get existing encryption key or create a new one.

**Returns**: Hex-encoded 256-bit encryption key

**Throws**: Error if key cannot be generated or retrieved

#### `validateKey(key: string): boolean`
Validate encryption key format.

**Returns**: `true` if key is valid, `false` otherwise

#### `async rotateEncryptionKey(): Promise<{oldKey: string, newKey: string}>`
Generate a new encryption key for rotation.

**Returns**: Object with old and new keys

#### `async confirmKeyRotation(newKey: string): Promise<boolean>`
Confirm key rotation after successful re-encryption.

**Returns**: `true` if new key stored successfully

### EncryptionMigration

#### `async migrateToEncrypted(oldDbPath, newDbPath, encryptionKey): Promise<MigrationResult>`
Migrate from unencrypted to encrypted database.

**Parameters**:
- `oldDbPath` - Path to unencrypted database
- `newDbPath` - Path for new encrypted database
- `encryptionKey` - Encryption key to use

**Returns**: `MigrationResult` with status and metadata

#### `isDatabaseMarkedEncrypted(dbPath: string): boolean`
Check if database has encryption metadata.

**Returns**: `true` if database is marked as encrypted

#### `verifyDatabaseIntegrity(dbPath: string, encryptionKey?: string): boolean`
Verify database integrity.

**Returns**: `true` if integrity check passes

## Testing

The implementation can be tested with the following scenarios:

### Test 1: Key Generation and Storage
```typescript
import { databaseEncryption } from './services/crypto/DatabaseEncryption.js';

const key = await databaseEncryption.getOrCreateEncryptionKey();
console.assert(key.length === 64, 'Key should be 64 hex characters');
console.assert(databaseEncryption.validateKey(key), 'Key should be valid');
```

### Test 2: Database Encryption Initialization
```typescript
import { ClaudeMemDatabase } from './services/sqlite/Database.js';

const db = new ClaudeMemDatabase(':memory:');
const success = await db.initializeWithEncryption();
console.assert(success, 'Initialization should succeed');
```

### Test 3: Encryption Status Check
```typescript
import { isDatabaseMarkedEncrypted } from './services/sqlite/EncryptionMigration.js';

const db = new ClaudeMemDatabase(':memory:');
await db.initializeWithEncryption();

// Database should be marked as encrypted
console.assert(db.isEncrypted(), 'Database should report encrypted status');
```

## Troubleshooting

### Keyring Not Available

If the OS keyring is not available (headless servers, Docker, etc.):

1. The system will log a warning
2. Fall back to environment variables:
   ```bash
   export DB_ENCRYPTION_KEY="your-64-character-hex-key"
   ```

### Migration Failures

If migration fails:

1. Check the error in the returned `MigrationResult`
2. Restore from the automatic backup (path in `result.backupPath`)
3. Verify disk space is available
4. Check database integrity before migration

### Key Rotation

To rotate encryption keys:

```typescript
import { databaseEncryption } from './services/crypto/DatabaseEncryption.js';

// Generate new key
const { oldKey, newKey } = await databaseEncryption.rotateEncryptionKey();

// Re-encrypt database with new key
// ... (implementation depends on SQLCipher availability)

// Confirm rotation
await databaseEncryption.confirmKeyRotation(newKey);
```

## Future Enhancements

- [ ] Automatic migration when SQLCipher becomes available
- [ ] Key rotation utilities for encrypted databases
- [ ] Backup encryption with separate keys
- [ ] Performance benchmarks for encrypted vs unencrypted
- [ ] CLI tools for encryption management
- [ ] Integration with claude-mem settings UI
