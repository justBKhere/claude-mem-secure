/**
 * Database Encryption Example
 *
 * This file demonstrates how to use the database encryption features.
 * Run with: bun src/services/sqlite/encryption-example.ts
 */

import { ClaudeMemDatabase } from './Database.js';
import { databaseEncryption } from '../crypto/DatabaseEncryption.js';
import {
  isDatabaseMarkedEncrypted,
  migrateToEncrypted,
  verifyDatabaseIntegrity,
  exportAllData
} from './EncryptionMigration.js';
import { DB_PATH, ENCRYPTED_DB_PATH } from '../../shared/paths.js';

async function example1_BasicEncryptionSetup() {
  console.log('\n=== Example 1: Basic Encryption Setup ===\n');

  // Create a database instance (using in-memory for testing)
  const db = new ClaudeMemDatabase(':memory:');

  // Initialize with encryption support
  console.log('Initializing database with encryption...');
  const success = await db.initializeWithEncryption();

  if (success) {
    console.log('✓ Encryption initialized successfully');
    console.log('✓ Database encrypted:', db.isEncrypted());

    // Get encryption key (for demonstration only - don't log in production!)
    const key = db.getEncryptionKey();
    if (key) {
      console.log('✓ Encryption key length:', key.length, 'characters (256-bit)');
    }
  } else {
    console.log('✗ Encryption initialization failed');
  }

  db.close();
}

async function example2_KeyManagement() {
  console.log('\n=== Example 2: Key Management ===\n');

  // Get or create an encryption key
  console.log('Getting or creating encryption key...');
  const key = await databaseEncryption.getOrCreateEncryptionKey();

  console.log('✓ Key retrieved/created');
  console.log('✓ Key length:', key.length, 'characters');

  // Validate the key
  const isValid = databaseEncryption.validateKey(key);
  console.log('✓ Key valid:', isValid);

  // Check if a key exists
  const hasKey = await databaseEncryption.hasEncryptionKey();
  console.log('✓ Has key in keyring:', hasKey);
}

async function example3_EncryptionStatus() {
  console.log('\n=== Example 3: Checking Encryption Status ===\n');

  // Create a test database
  const db = new ClaudeMemDatabase(':memory:');
  await db.initializeWithEncryption();

  // Check encryption status
  console.log('Encryption status checks:');
  console.log('✓ Is encrypted (via instance):', db.isEncrypted());

  // Insert some test data
  db.db.run(`
    CREATE TABLE IF NOT EXISTS test_table (
      id INTEGER PRIMARY KEY,
      data TEXT
    )
  `);

  db.db.run(`INSERT INTO test_table (data) VALUES (?)`, 'Test data 1');
  db.db.run(`INSERT INTO test_table (data) VALUES (?)`, 'Test data 2');

  // Export data (to show it can be extracted)
  const exportedData = exportAllData(db.db);
  console.log('✓ Exported tables:', exportedData.length);

  for (const table of exportedData) {
    console.log(`  - ${table.name}: ${table.rows.length} rows`);
  }

  db.close();
}

async function example4_KeyRotation() {
  console.log('\n=== Example 4: Key Rotation ===\n');

  // Rotate encryption key
  console.log('Rotating encryption key...');

  try {
    const { oldKey, newKey } = await databaseEncryption.rotateEncryptionKey();

    console.log('✓ Old key length:', oldKey.length);
    console.log('✓ New key length:', newKey.length);
    console.log('✓ Keys are different:', oldKey !== newKey);

    // In production, you would:
    // 1. Re-encrypt the database with the new key
    // 2. Confirm the rotation
    // await databaseEncryption.confirmKeyRotation(newKey);

    console.log('\nNote: Key rotation generated but not confirmed.');
    console.log('In production, re-encrypt database before confirming.');
  } catch (error) {
    console.log('Note: Key rotation requires an existing key in the keyring.');
    console.log('Create a database first with initializeWithEncryption()');
  }
}

async function example5_DataMigration() {
  console.log('\n=== Example 5: Simulated Data Migration ===\n');

  // This example shows how migration would work (using in-memory databases)
  console.log('Creating source database with test data...');

  const sourceDb = new ClaudeMemDatabase(':memory:');

  // Create and populate test table
  sourceDb.db.run(`
    CREATE TABLE test_data (
      id INTEGER PRIMARY KEY,
      content TEXT,
      created_at TEXT
    )
  `);

  for (let i = 1; i <= 5; i++) {
    sourceDb.db.run(
      `INSERT INTO test_data (content, created_at) VALUES (?, ?)`,
      `Test record ${i}`,
      new Date().toISOString()
    );
  }

  // Export all data
  const exportedData = exportAllData(sourceDb.db);
  console.log('✓ Exported data from source database');
  console.log('  Tables:', exportedData.length);
  console.log('  Total rows:', exportedData.reduce((sum, t) => sum + t.rows.length, 0));

  // Show what was exported
  for (const table of exportedData) {
    console.log(`  - ${table.name}: ${table.rows.length} rows`);
  }

  sourceDb.close();

  console.log('\nNote: This demonstrates the export process.');
  console.log('Full migration with migrateToEncrypted() would:');
  console.log('1. Export all data from source');
  console.log('2. Create encrypted target database');
  console.log('3. Import data to encrypted database');
  console.log('4. Verify integrity');
  console.log('5. Create backup of original');
}

async function example6_IntegrityCheck() {
  console.log('\n=== Example 6: Database Integrity Check ===\n');

  // Create test database
  const db = new ClaudeMemDatabase(':memory:');

  // Create test table
  db.db.run(`
    CREATE TABLE integrity_test (
      id INTEGER PRIMARY KEY,
      value TEXT
    )
  `);

  db.db.run(`INSERT INTO integrity_test (value) VALUES (?)`, 'Test');

  // Note: verifyDatabaseIntegrity requires a file path, not in-memory
  console.log('Note: Integrity checks work on file-based databases');
  console.log('For in-memory databases, you can verify data access works:');

  try {
    const query = db.db.query('SELECT * FROM integrity_test');
    const result = query.all();
    console.log('✓ Database accessible, rows:', result.length);
  } catch (error) {
    console.log('✗ Database access failed:', error);
  }

  db.close();
}

// Main function to run all examples
async function runAllExamples() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Claude-Mem Database Encryption Examples                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  try {
    await example1_BasicEncryptionSetup();
    await example2_KeyManagement();
    await example3_EncryptionStatus();
    await example4_KeyRotation();
    await example5_DataMigration();
    await example6_IntegrityCheck();

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║     All Examples Completed Successfully                    ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    console.log('Key Takeaways:');
    console.log('- Encryption keys are managed via OS keyring');
    console.log('- Databases are marked for encryption with metadata');
    console.log('- Migration utilities are ready for SQLCipher integration');
    console.log('- All operations include proper error handling and logging');

  } catch (error) {
    console.error('\n✗ Example failed:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.main) {
  runAllExamples();
}

// Export for use in other files
export {
  example1_BasicEncryptionSetup,
  example2_KeyManagement,
  example3_EncryptionStatus,
  example4_KeyRotation,
  example5_DataMigration,
  example6_IntegrityCheck
};
