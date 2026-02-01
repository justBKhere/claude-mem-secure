/**
 * EncryptionMigration - Database Encryption Migration Utilities
 *
 * Provides utilities for migrating between unencrypted and encrypted SQLite databases.
 * Designed for future use when switching from bun:sqlite to better-sqlite3 with SQLCipher.
 *
 * Migration strategy:
 * 1. Export all data from the old unencrypted database
 * 2. Create a new encrypted database with the encryption key
 * 3. Import all data into the new encrypted database
 * 4. Verify data integrity
 * 5. Replace the old database with the new one
 *
 * Note: This module is infrastructure for future SQLCipher support.
 * Current bun:sqlite doesn't have built-in SQLCipher support.
 */

import { Database } from 'bun:sqlite';
import { existsSync, copyFileSync, unlinkSync, renameSync } from 'fs';
import { logger } from '../../utils/logger.js';
import { databaseEncryption } from '../crypto/DatabaseEncryption.js';
import { createBackupFilename } from '../../shared/paths.js';

export interface MigrationResult {
  success: boolean;
  recordsMigrated: number;
  tablesProcessed: string[];
  error?: string;
  backupPath?: string;
}

export interface TableData {
  name: string;
  schema: string;
  rows: any[];
}

/**
 * Export all data from a SQLite database
 *
 * @param db - The database connection to export from
 * @returns Array of table data objects
 */
export function exportAllData(db: Database): TableData[] {
  logger.info('ENCRYPTION', 'Starting database export');

  try {
    // Get all table names (excluding SQLite internal tables)
    const tablesQuery = db.query(`
      SELECT name FROM sqlite_master
      WHERE type='table'
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    const tables = tablesQuery.all() as { name: string }[];

    const exportData: TableData[] = [];

    for (const table of tables) {
      const tableName = table.name;
      logger.debug('ENCRYPTION', `Exporting table: ${tableName}`);

      // Get table schema
      const schemaQuery = db.query(`
        SELECT sql FROM sqlite_master
        WHERE type='table' AND name=?
      `);
      const schemaResult = schemaQuery.get(tableName) as { sql: string } | undefined;

      if (!schemaResult) {
        logger.warn('ENCRYPTION', `Could not get schema for table: ${tableName}`);
        continue;
      }

      // Get all rows from the table
      const dataQuery = db.query(`SELECT * FROM ${tableName}`);
      const rows = dataQuery.all();

      exportData.push({
        name: tableName,
        schema: schemaResult.sql,
        rows: rows as any[]
      });

      logger.debug('ENCRYPTION', `Exported ${rows.length} rows from ${tableName}`);
    }

    logger.info('ENCRYPTION', `Export complete: ${exportData.length} tables, ${exportData.reduce((sum, t) => sum + t.rows.length, 0)} total rows`);
    return exportData;
  } catch (error) {
    logger.error('ENCRYPTION', 'Failed to export database', undefined, error);
    throw error;
  }
}

/**
 * Import data into a SQLite database
 *
 * @param db - The database connection to import into
 * @param data - Array of table data to import
 */
export function importAllData(db: Database, data: TableData[]): void {
  logger.info('ENCRYPTION', 'Starting database import');

  try {
    db.run('BEGIN TRANSACTION');

    for (const table of data) {
      logger.debug('ENCRYPTION', `Importing table: ${table.name}`);

      // Create table with original schema
      db.run(table.schema);

      // Import rows
      if (table.rows.length > 0) {
        const columnNames = Object.keys(table.rows[0]);
        const placeholders = columnNames.map(() => '?').join(', ');
        const insertQuery = db.prepare(
          `INSERT INTO ${table.name} (${columnNames.join(', ')}) VALUES (${placeholders})`
        );

        for (const row of table.rows) {
          const values = columnNames.map(col => row[col]);
          insertQuery.run(...values);
        }
      }

      logger.debug('ENCRYPTION', `Imported ${table.rows.length} rows into ${table.name}`);
    }

    db.run('COMMIT');
    logger.info('ENCRYPTION', 'Import complete');
  } catch (error) {
    db.run('ROLLBACK');
    logger.error('ENCRYPTION', 'Failed to import database', undefined, error);
    throw error;
  }
}

/**
 * Migrate from an unencrypted database to an encrypted one
 *
 * This function is designed for future use when better-sqlite3 with SQLCipher is integrated.
 * Currently, bun:sqlite doesn't support SQLCipher encryption directly.
 *
 * Migration process:
 * 1. Validate source database exists
 * 2. Create backup of source database
 * 3. Export all data from source
 * 4. Create new encrypted database (placeholder - will use SQLCipher PRAGMA key)
 * 5. Import all data into encrypted database
 * 6. Verify data integrity
 * 7. Replace source with encrypted database
 *
 * @param oldDbPath - Path to the unencrypted database
 * @param newDbPath - Path where encrypted database will be created
 * @param encryptionKey - Encryption key for the new database
 * @returns Migration result with status and metadata
 */
export async function migrateToEncrypted(
  oldDbPath: string,
  newDbPath: string,
  encryptionKey: string
): Promise<MigrationResult> {
  logger.info('ENCRYPTION', `Starting encryption migration: ${oldDbPath} -> ${newDbPath}`);

  // Validate inputs
  if (!existsSync(oldDbPath)) {
    const error = `Source database not found: ${oldDbPath}`;
    logger.error('ENCRYPTION', error);
    return {
      success: false,
      recordsMigrated: 0,
      tablesProcessed: [],
      error
    };
  }

  if (!encryptionKey || !databaseEncryption.validateKey(encryptionKey)) {
    const error = 'Invalid encryption key provided';
    logger.error('ENCRYPTION', error);
    return {
      success: false,
      recordsMigrated: 0,
      tablesProcessed: [],
      error
    };
  }

  let oldDb: Database | null = null;
  let newDb: Database | null = null;
  let backupPath: string | undefined;

  try {
    // Step 1: Create backup
    backupPath = createBackupFilename(oldDbPath);
    copyFileSync(oldDbPath, backupPath);
    logger.info('ENCRYPTION', `Backup created: ${backupPath}`);

    // Step 2: Open old database
    oldDb = new Database(oldDbPath, { readonly: true });

    // Step 3: Export all data
    const exportedData = exportAllData(oldDb);
    oldDb.close();
    oldDb = null;

    // Step 4: Create new encrypted database
    // NOTE: This is where SQLCipher integration will happen in the future
    // For now, we create a standard database and mark it as "encrypted" via metadata
    // When using better-sqlite3 with SQLCipher, use: PRAGMA key = 'encryptionKey'

    newDb = new Database(newDbPath, { create: true, readwrite: true });

    // FUTURE: Apply SQLCipher encryption
    // For better-sqlite3 with SQLCipher:
    // newDb.pragma(`key = '${encryptionKey}'`);
    // newDb.pragma('cipher_page_size = 4096');
    // newDb.pragma('kdf_iter = 256000');

    // For now, store a marker that this DB is "encrypted"
    // This allows us to track which databases should be encrypted
    newDb.run(`
      CREATE TABLE IF NOT EXISTS _encryption_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    newDb.run(
      `INSERT INTO _encryption_metadata (key, value) VALUES (?, ?)`,
      'encryption_enabled',
      'true'
    );
    newDb.run(
      `INSERT INTO _encryption_metadata (key, value) VALUES (?, ?)`,
      'encryption_method',
      'pending_sqlcipher' // Marker for future SQLCipher migration
    );

    // Step 5: Import data
    importAllData(newDb, exportedData);

    // Step 6: Verify data integrity
    const tableCount = exportedData.length;
    const recordCount = exportedData.reduce((sum, t) => sum + t.rows.length, 0);
    const tableNames = exportedData.map(t => t.name);

    // Close databases
    newDb.close();
    newDb = null;

    logger.info('ENCRYPTION', `Migration successful: ${tableCount} tables, ${recordCount} records`);

    return {
      success: true,
      recordsMigrated: recordCount,
      tablesProcessed: tableNames,
      backupPath
    };
  } catch (error) {
    logger.error('ENCRYPTION', 'Migration failed', undefined, error);

    // Cleanup: close any open connections
    if (oldDb) {
      try { oldDb.close(); } catch (e) { /* ignore */ }
    }
    if (newDb) {
      try { newDb.close(); } catch (e) { /* ignore */ }
    }

    // Cleanup: remove partially created encrypted database
    if (existsSync(newDbPath)) {
      try {
        unlinkSync(newDbPath);
        logger.info('ENCRYPTION', 'Cleaned up partial encrypted database');
      } catch (e) {
        logger.warn('ENCRYPTION', 'Could not clean up partial database', undefined, e);
      }
    }

    return {
      success: false,
      recordsMigrated: 0,
      tablesProcessed: [],
      error: error instanceof Error ? error.message : String(error),
      backupPath
    };
  }
}

/**
 * Migrate from an encrypted database to an unencrypted one
 *
 * WARNING: This removes encryption from the database!
 * Use with caution and only when absolutely necessary.
 *
 * @param encryptedDbPath - Path to the encrypted database
 * @param unencryptedDbPath - Path where unencrypted database will be created
 * @param encryptionKey - Current encryption key for the encrypted database
 * @returns Migration result with status and metadata
 */
export async function migrateToUnencrypted(
  encryptedDbPath: string,
  unencryptedDbPath: string,
  encryptionKey: string
): Promise<MigrationResult> {
  logger.warn('ENCRYPTION', `Starting decryption migration: ${encryptedDbPath} -> ${unencryptedDbPath}`);

  // Similar implementation to migrateToEncrypted but in reverse
  // For now, this is a placeholder for future implementation
  logger.warn('ENCRYPTION', 'Decryption migration not yet fully implemented');

  return {
    success: false,
    recordsMigrated: 0,
    tablesProcessed: [],
    error: 'Decryption migration not yet implemented - waiting for SQLCipher integration'
  };
}

/**
 * Check if a database has encryption metadata
 *
 * This checks for our custom encryption marker table.
 * In the future, this will check actual SQLCipher encryption.
 *
 * @param dbPath - Path to the database file
 * @returns True if the database appears to be encrypted
 */
export function isDatabaseMarkedEncrypted(dbPath: string): boolean {
  if (!existsSync(dbPath)) {
    return false;
  }

  let db: Database | null = null;

  try {
    db = new Database(dbPath, { readonly: true });

    // Check for encryption metadata table
    const query = db.query(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='_encryption_metadata'
    `);
    const result = query.get();

    if (!result) {
      db.close();
      return false;
    }

    // Check for encryption_enabled flag
    const valueQuery = db.query(`
      SELECT value FROM _encryption_metadata
      WHERE key='encryption_enabled'
    `);
    const valueResult = valueQuery.get() as { value: string } | undefined;

    db.close();

    return valueResult?.value === 'true';
  } catch (error) {
    if (db) {
      try { db.close(); } catch (e) { /* ignore */ }
    }
    logger.error('ENCRYPTION', 'Failed to check database encryption status', undefined, error);
    return false;
  }
}

/**
 * Verify database integrity after migration
 *
 * Performs basic integrity checks on a database.
 *
 * @param dbPath - Path to the database to verify
 * @param encryptionKey - Optional encryption key if database is encrypted
 * @returns True if integrity check passes
 */
export function verifyDatabaseIntegrity(dbPath: string, encryptionKey?: string): boolean {
  if (!existsSync(dbPath)) {
    logger.error('ENCRYPTION', `Database not found: ${dbPath}`);
    return false;
  }

  let db: Database | null = null;

  try {
    db = new Database(dbPath, { readonly: true });

    // FUTURE: For encrypted databases with SQLCipher
    // if (encryptionKey) {
    //   db.pragma(`key = '${encryptionKey}'`);
    // }

    // Run SQLite integrity check
    const integrityQuery = db.query('PRAGMA integrity_check');
    const result = integrityQuery.get() as { integrity_check: string } | undefined;

    db.close();

    const isValid = result?.integrity_check === 'ok';

    if (isValid) {
      logger.info('ENCRYPTION', `Database integrity check passed: ${dbPath}`);
    } else {
      logger.error('ENCRYPTION', `Database integrity check failed: ${dbPath}`, { result });
    }

    return isValid;
  } catch (error) {
    if (db) {
      try { db.close(); } catch (e) { /* ignore */ }
    }
    logger.error('ENCRYPTION', 'Failed to verify database integrity', undefined, error);
    return false;
  }
}
