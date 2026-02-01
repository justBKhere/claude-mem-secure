import { Database } from 'bun:sqlite';
import { DATA_DIR, DB_PATH, ENCRYPTED_DB_PATH, DB_ENCRYPTION_ENABLED_PATH, ensureDir } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { MigrationRunner } from './migrations/runner.js';
import { databaseEncryption } from '../crypto/DatabaseEncryption.js';
import { isDatabaseMarkedEncrypted, migrateToEncrypted } from './EncryptionMigration.js';
import { existsSync, writeFileSync, readFileSync } from 'fs';

// SQLite configuration constants
const SQLITE_MMAP_SIZE_BYTES = 256 * 1024 * 1024; // 256MB
const SQLITE_CACHE_SIZE_PAGES = 10_000;

export interface Migration {
  version: number;
  up: (db: Database) => void;
  down?: (db: Database) => void;
}

let dbInstance: Database | null = null;

/**
 * ClaudeMemDatabase - New entry point for the sqlite module
 *
 * Replaces SessionStore as the database coordinator.
 * Sets up bun:sqlite with optimized settings and runs all migrations.
 *
 * Usage:
 *   const db = new ClaudeMemDatabase();  // uses default DB_PATH
 *   const db = new ClaudeMemDatabase('/path/to/db.sqlite');
 *   const db = new ClaudeMemDatabase(':memory:');  // for tests
 */
export class ClaudeMemDatabase {
  public db: Database;
  private encryptionKey: string | null = null;
  private _isEncrypted: boolean = false;

  constructor(dbPath: string = DB_PATH) {
    // Ensure data directory exists (skip for in-memory databases)
    if (dbPath !== ':memory:') {
      ensureDir(DATA_DIR);
    }

    // Create database connection
    this.db = new Database(dbPath, { create: true, readwrite: true });

    // Check if database is marked as encrypted
    this._isEncrypted = isDatabaseMarkedEncrypted(dbPath);

    // Apply optimized SQLite settings
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run('PRAGMA temp_store = memory');
    this.db.run(`PRAGMA mmap_size = ${SQLITE_MMAP_SIZE_BYTES}`);
    this.db.run(`PRAGMA cache_size = ${SQLITE_CACHE_SIZE_PAGES}`);

    // Run all migrations
    const migrationRunner = new MigrationRunner(this.db);
    migrationRunner.runAllMigrations();
  }

  /**
   * Initialize database with encryption support
   *
   * This method prepares the database for encryption:
   * 1. Gets or creates an encryption key from the keyring
   * 2. Checks if encryption should be enabled
   * 3. Marks the database for future SQLCipher encryption
   *
   * Note: Actual SQLCipher encryption requires better-sqlite3.
   * This method sets up the infrastructure for when that migration happens.
   *
   * @returns True if initialization succeeded
   */
  async initializeWithEncryption(): Promise<boolean> {
    try {
      logger.info('DB', 'Initializing database with encryption support');

      // Get or create encryption key
      this.encryptionKey = await databaseEncryption.getOrCreateEncryptionKey();

      if (!this.encryptionKey) {
        logger.error('DB', 'Failed to get encryption key');
        return false;
      }

      // Validate the key
      if (!databaseEncryption.validateKey(this.encryptionKey)) {
        logger.error('DB', 'Invalid encryption key format');
        return false;
      }

      // Check if we should enable encryption
      const encryptionEnabled = this.shouldEnableEncryption();

      if (encryptionEnabled && !this._isEncrypted) {
        logger.info('DB', 'Marking database for encryption');

        // Create encryption metadata table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS _encryption_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);

        // Mark database as encrypted (pending SQLCipher implementation)
        this.db.run(
          `INSERT OR REPLACE INTO _encryption_metadata (key, value) VALUES (?, ?)`,
          'encryption_enabled',
          'true'
        );

        this.db.run(
          `INSERT OR REPLACE INTO _encryption_metadata (key, value) VALUES (?, ?)`,
          'encryption_method',
          'pending_sqlcipher'
        );

        this.db.run(
          `INSERT OR REPLACE INTO _encryption_metadata (key, value) VALUES (?, ?)`,
          'initialized_at',
          new Date().toISOString()
        );

        this._isEncrypted = true;

        // Write encryption enabled flag to file system
        writeFileSync(DB_ENCRYPTION_ENABLED_PATH, 'true');

        logger.info('DB', 'Database marked for encryption (SQLCipher migration pending)');
      } else if (encryptionEnabled && this._isEncrypted) {
        logger.info('DB', 'Database already encrypted');
      } else {
        logger.info('DB', 'Database encryption not enabled');
      }

      return true;
    } catch (error) {
      logger.error('DB', 'Failed to initialize encryption', undefined, error);
      return false;
    }
  }

  /**
   * Check if database encryption is enabled
   *
   * @returns True if the database is encrypted or marked for encryption
   */
  isEncrypted(): boolean {
    return this._isEncrypted;
  }

  /**
   * Get encryption key (if available)
   *
   * Only returns the key if encryption has been initialized.
   *
   * @returns The encryption key or null if not available
   */
  getEncryptionKey(): string | null {
    return this.encryptionKey;
  }

  /**
   * Check if encryption should be enabled based on configuration
   *
   * Encryption is enabled if:
   * 1. The encryption flag file exists, OR
   * 2. An encryption key exists in the keyring
   *
   * @returns True if encryption should be enabled
   */
  private shouldEnableEncryption(): boolean {
    // Check for encryption flag file
    if (existsSync(DB_ENCRYPTION_ENABLED_PATH)) {
      try {
        const content = readFileSync(DB_ENCRYPTION_ENABLED_PATH, 'utf-8').trim();
        return content === 'true';
      } catch (error) {
        logger.warn('DB', 'Failed to read encryption flag file', undefined, error);
      }
    }

    // If no explicit flag, encryption is off by default
    // Users must explicitly enable it
    return false;
  }

  /**
   * Migrate current database to encrypted format
   *
   * This method:
   * 1. Closes the current database connection
   * 2. Migrates data to a new encrypted database
   * 3. Reopens the encrypted database
   *
   * Note: This is infrastructure for future SQLCipher support.
   *
   * @returns True if migration succeeded
   */
  async migrateToEncrypted(): Promise<boolean> {
    try {
      if (this._isEncrypted) {
        logger.warn('DB', 'Database is already encrypted');
        return true;
      }

      logger.info('DB', 'Starting database encryption migration');

      // Get encryption key
      if (!this.encryptionKey) {
        this.encryptionKey = await databaseEncryption.getOrCreateEncryptionKey();
      }

      if (!this.encryptionKey) {
        logger.error('DB', 'Cannot migrate without encryption key');
        return false;
      }

      // Close current database
      const currentDbPath = DB_PATH;
      this.close();

      // Perform migration
      const result = await migrateToEncrypted(
        currentDbPath,
        ENCRYPTED_DB_PATH,
        this.encryptionKey
      );

      if (!result.success) {
        logger.error('DB', 'Migration failed', { error: result.error });

        // Reopen original database
        this.db = new Database(currentDbPath, { readwrite: true });
        return false;
      }

      logger.info('DB', 'Migration successful', {
        tables: result.tablesProcessed.length,
        records: result.recordsMigrated,
        backup: result.backupPath
      });

      // Reopen the encrypted database
      this.db = new Database(ENCRYPTED_DB_PATH, { readwrite: true });
      this._isEncrypted = true;

      // Update encryption flag
      writeFileSync(DB_ENCRYPTION_ENABLED_PATH, 'true');

      return true;
    } catch (error) {
      logger.error('DB', 'Failed to migrate database to encrypted format', undefined, error);
      return false;
    }
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

/**
 * SQLite Database singleton with migration support and optimized settings
 * @deprecated Use ClaudeMemDatabase instead for new code
 */
export class DatabaseManager {
  private static instance: DatabaseManager;
  private db: Database | null = null;
  private migrations: Migration[] = [];
  private encryptionKey: string | null = null;
  private _isEncrypted: boolean = false;

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  /**
   * Register a migration to be run during initialization
   */
  registerMigration(migration: Migration): void {
    this.migrations.push(migration);
    // Keep migrations sorted by version
    this.migrations.sort((a, b) => a.version - b.version);
  }

  /**
   * Initialize database connection with optimized settings
   */
  async initialize(): Promise<Database> {
    if (this.db) {
      return this.db;
    }

    // Ensure the data directory exists
    ensureDir(DATA_DIR);

    // Determine which database to use (encrypted or standard)
    const dbPath = this.shouldUseEncryptedDb() ? ENCRYPTED_DB_PATH : DB_PATH;

    this.db = new Database(dbPath, { create: true, readwrite: true });

    // Check if database is marked as encrypted
    this._isEncrypted = isDatabaseMarkedEncrypted(dbPath);

    // Apply optimized SQLite settings
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA synchronous = NORMAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run('PRAGMA temp_store = memory');
    this.db.run(`PRAGMA mmap_size = ${SQLITE_MMAP_SIZE_BYTES}`);
    this.db.run(`PRAGMA cache_size = ${SQLITE_CACHE_SIZE_PAGES}`);

    // Initialize schema_versions table
    this.initializeSchemaVersions();

    // Run migrations
    await this.runMigrations();

    dbInstance = this.db;
    return this.db;
  }

  /**
   * Initialize database with encryption support
   *
   * Call this after initialize() to set up encryption.
   *
   * @returns True if encryption setup succeeded
   */
  async initializeWithEncryption(): Promise<boolean> {
    if (!this.db) {
      logger.error('DB', 'Cannot initialize encryption: database not initialized');
      return false;
    }

    try {
      logger.info('DB', 'Initializing database encryption (legacy DatabaseManager)');

      // Get or create encryption key
      this.encryptionKey = await databaseEncryption.getOrCreateEncryptionKey();

      if (!this.encryptionKey) {
        logger.error('DB', 'Failed to get encryption key');
        return false;
      }

      // Validate the key
      if (!databaseEncryption.validateKey(this.encryptionKey)) {
        logger.error('DB', 'Invalid encryption key format');
        return false;
      }

      // Check if we should enable encryption
      const encryptionEnabled = this.shouldEnableEncryption();

      if (encryptionEnabled && !this._isEncrypted) {
        logger.info('DB', 'Marking database for encryption');

        // Create encryption metadata table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS _encryption_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )
        `);

        // Mark database as encrypted
        this.db.run(
          `INSERT OR REPLACE INTO _encryption_metadata (key, value) VALUES (?, ?)`,
          'encryption_enabled',
          'true'
        );

        this.db.run(
          `INSERT OR REPLACE INTO _encryption_metadata (key, value) VALUES (?, ?)`,
          'encryption_method',
          'pending_sqlcipher'
        );

        this._isEncrypted = true;

        // Write encryption enabled flag
        writeFileSync(DB_ENCRYPTION_ENABLED_PATH, 'true');

        logger.info('DB', 'Database marked for encryption');
      }

      return true;
    } catch (error) {
      logger.error('DB', 'Failed to initialize encryption', undefined, error);
      return false;
    }
  }

  /**
   * Check if database is encrypted
   */
  isEncrypted(): boolean {
    return this._isEncrypted;
  }

  /**
   * Check if we should use the encrypted database
   */
  private shouldUseEncryptedDb(): boolean {
    return existsSync(ENCRYPTED_DB_PATH) && existsSync(DB_ENCRYPTION_ENABLED_PATH);
  }

  /**
   * Check if encryption should be enabled
   */
  private shouldEnableEncryption(): boolean {
    if (existsSync(DB_ENCRYPTION_ENABLED_PATH)) {
      try {
        const content = readFileSync(DB_ENCRYPTION_ENABLED_PATH, 'utf-8').trim();
        return content === 'true';
      } catch (error) {
        logger.warn('DB', 'Failed to read encryption flag file', undefined, error);
      }
    }
    return false;
  }

  /**
   * Get the current database connection
   */
  getConnection(): Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a function within a transaction
   */
  withTransaction<T>(fn: (db: Database) => T): T {
    const db = this.getConnection();
    const transaction = db.transaction(fn);
    return transaction(db);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      dbInstance = null;
    }
  }

  /**
   * Initialize the schema_versions table
   */
  private initializeSchemaVersions(): void {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);
  }

  /**
   * Run all pending migrations
   */
  private async runMigrations(): Promise<void> {
    if (!this.db) return;

    const query = this.db.query('SELECT version FROM schema_versions ORDER BY version');
    const appliedVersions = query.all().map((row: any) => row.version);

    const maxApplied = appliedVersions.length > 0 ? Math.max(...appliedVersions) : 0;

    for (const migration of this.migrations) {
      if (migration.version > maxApplied) {
        logger.info('DB', `Applying migration ${migration.version}`);

        const transaction = this.db.transaction(() => {
          migration.up(this.db!);

          const insertQuery = this.db!.query('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)');
          insertQuery.run(migration.version, new Date().toISOString());
        });

        transaction();
        logger.info('DB', `Migration ${migration.version} applied successfully`);
      }
    }
  }

  /**
   * Get current schema version
   */
  getCurrentVersion(): number {
    if (!this.db) return 0;

    const query = this.db.query('SELECT MAX(version) as version FROM schema_versions');
    const result = query.get() as { version: number } | undefined;

    return result?.version || 0;
  }
}

/**
 * Get the global database instance (for compatibility)
 */
export function getDatabase(): Database {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call DatabaseManager.getInstance().initialize() first.');
  }
  return dbInstance;
}

/**
 * Initialize and get database manager
 */
export async function initializeDatabase(): Promise<Database> {
  const manager = DatabaseManager.getInstance();
  return await manager.initialize();
}

// Re-export bun:sqlite Database type
export { Database };

// Re-export MigrationRunner for external use
export { MigrationRunner } from './migrations/runner.js';

// Re-export all module functions for convenient imports
export * from './Sessions.js';
export * from './Observations.js';
export * from './Summaries.js';
export * from './Prompts.js';
export * from './Timeline.js';
export * from './Import.js';
export * from './transactions.js';