/**
 * SettingsDefaultsManager
 *
 * Single source of truth for all default configuration values.
 * Provides methods to get defaults with optional environment variable overrides.
 * Integrates with KeyringManager for secure secret storage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { DEFAULT_OBSERVATION_TYPES_STRING, DEFAULT_OBSERVATION_CONCEPTS_STRING } from '../constants/observation-metadata.js';
import { keyringManager } from '../services/crypto/KeyringManager.js';
// NOTE: Do NOT import logger here - it creates a circular dependency
// logger.ts depends on SettingsDefaultsManager for its initialization

export interface SettingsDefaults {
  CLAUDE_MEM_MODEL: string;
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: string;
  CLAUDE_MEM_WORKER_PORT: string;
  CLAUDE_MEM_WORKER_HOST: string;
  CLAUDE_MEM_SKIP_TOOLS: string;
  // AI Provider Configuration
  CLAUDE_MEM_PROVIDER: string;  // 'claude' | 'gemini' | 'openrouter'
  // NOTE: API keys are stored in OS keyring via KeyringManager, not in settings.json
  CLAUDE_MEM_GEMINI_MODEL: string;  // 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-3-flash'
  CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: string;  // 'true' | 'false' - enable rate limiting for free tier
  CLAUDE_MEM_OPENROUTER_MODEL: string;
  CLAUDE_MEM_OPENROUTER_SITE_URL: string;
  CLAUDE_MEM_OPENROUTER_APP_NAME: string;
  CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: string;
  CLAUDE_MEM_OPENROUTER_MAX_TOKENS: string;
  // System Configuration
  CLAUDE_MEM_DATA_DIR: string;
  CLAUDE_MEM_LOG_LEVEL: string;
  CLAUDE_MEM_PYTHON_VERSION: string;
  CLAUDE_CODE_PATH: string;
  CLAUDE_MEM_MODE: string;
  // Token Economics
  CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS: string;
  CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: string;
  // Observation Filtering
  CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: string;
  CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: string;
  // Display Configuration
  CLAUDE_MEM_CONTEXT_FULL_COUNT: string;
  CLAUDE_MEM_CONTEXT_FULL_FIELD: string;
  CLAUDE_MEM_CONTEXT_SESSION_COUNT: string;
  // Feature Toggles
  CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: string;
  CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE: string;
  // Retention Settings
  CLAUDE_MEM_RETENTION_ENABLED: string;
  CLAUDE_MEM_RETENTION_DAYS: string;
  CLAUDE_MEM_ARCHIVE_BEFORE_DELETE: string;
  CLAUDE_MEM_ARCHIVE_PATH: string;
  // Privacy Controls
  CLAUDE_MEM_REDACT_PATTERNS: string;
}

export class SettingsDefaultsManager {
  /**
   * Default values for all settings
   * NOTE: Secrets (API keys) are no longer stored here - they're in OS keyring
   */
  private static readonly DEFAULTS: SettingsDefaults = {
    CLAUDE_MEM_MODEL: 'claude-sonnet-4-5',
    CLAUDE_MEM_CONTEXT_OBSERVATIONS: '50',
    CLAUDE_MEM_WORKER_PORT: '37777',
    CLAUDE_MEM_WORKER_HOST: '127.0.0.1',
    CLAUDE_MEM_SKIP_TOOLS: 'ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion',
    // AI Provider Configuration
    CLAUDE_MEM_PROVIDER: 'claude',  // Default to Claude
    // API keys removed - stored in OS keyring via KeyringManager
    CLAUDE_MEM_GEMINI_MODEL: 'gemini-2.5-flash-lite',  // Default Gemini model (highest free tier RPM)
    CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: 'true',  // Rate limiting ON by default for free tier users
    CLAUDE_MEM_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',  // Default OpenRouter model (free tier)
    CLAUDE_MEM_OPENROUTER_SITE_URL: '',  // Optional: for OpenRouter analytics
    CLAUDE_MEM_OPENROUTER_APP_NAME: 'claude-mem',  // App name for OpenRouter analytics
    CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: '20',  // Max messages in context window
    CLAUDE_MEM_OPENROUTER_MAX_TOKENS: '100000',  // Max estimated tokens (~100k safety limit)
    // System Configuration
    CLAUDE_MEM_DATA_DIR: join(homedir(), '.claude-mem'),
    CLAUDE_MEM_LOG_LEVEL: 'INFO',
    CLAUDE_MEM_PYTHON_VERSION: '3.13',
    CLAUDE_CODE_PATH: '', // Empty means auto-detect via 'which claude'
    CLAUDE_MEM_MODE: 'code', // Default mode profile
    // Token Economics
    CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: 'true',
    // Observation Filtering
    CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: DEFAULT_OBSERVATION_TYPES_STRING,
    CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: DEFAULT_OBSERVATION_CONCEPTS_STRING,
    // Display Configuration
    CLAUDE_MEM_CONTEXT_FULL_COUNT: '5',
    CLAUDE_MEM_CONTEXT_FULL_FIELD: 'narrative',
    CLAUDE_MEM_CONTEXT_SESSION_COUNT: '10',
    // Feature Toggles
    CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE: 'false',
    // Retention Settings
    CLAUDE_MEM_RETENTION_ENABLED: 'true',
    CLAUDE_MEM_RETENTION_DAYS: '90',
    CLAUDE_MEM_ARCHIVE_BEFORE_DELETE: 'true',
    CLAUDE_MEM_ARCHIVE_PATH: '', // Empty means use default ~/.claude-mem/archives/
    // Privacy Controls
    CLAUDE_MEM_REDACT_PATTERNS: '', // Empty means no custom patterns, comma-separated regex patterns
  };

  /**
   * Get all defaults as an object
   */
  static getAllDefaults(): SettingsDefaults {
    return { ...this.DEFAULTS };
  }

  /**
   * Get a default value from defaults (no environment variable override)
   */
  static get(key: keyof SettingsDefaults): string {
    return this.DEFAULTS[key];
  }

  /**
   * Get an integer default value
   */
  static getInt(key: keyof SettingsDefaults): number {
    const value = this.get(key);
    return parseInt(value, 10);
  }

  /**
   * Get a boolean default value
   */
  static getBool(key: keyof SettingsDefaults): boolean {
    const value = this.get(key);
    return value === 'true';
  }

  /**
   * Load settings from file with fallback to defaults
   * Returns merged settings with defaults as fallback
   * Handles all errors (missing file, corrupted JSON, permissions) by returning defaults
   */
  static loadFromFile(settingsPath: string): SettingsDefaults {
    try {
      if (!existsSync(settingsPath)) {
        const defaults = this.getAllDefaults();
        try {
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8');
          // Use console instead of logger to avoid circular dependency
          console.log('[SETTINGS] Created settings file with defaults:', settingsPath);
        } catch (error) {
          console.warn('[SETTINGS] Failed to create settings file, using in-memory defaults:', settingsPath, error);
        }
        return defaults;
      }

      const settingsData = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsData);

      // MIGRATION: Handle old nested schema { env: {...} }
      let flatSettings = settings;
      if (settings.env && typeof settings.env === 'object') {
        // Migrate from nested to flat schema
        flatSettings = settings.env;

        // Auto-migrate the file to flat schema
        try {
          writeFileSync(settingsPath, JSON.stringify(flatSettings, null, 2), 'utf-8');
          console.log('[SETTINGS] Migrated settings file from nested to flat schema:', settingsPath);
        } catch (error) {
          console.warn('[SETTINGS] Failed to auto-migrate settings file:', settingsPath, error);
          // Continue with in-memory migration even if write fails
        }
      }

      // Merge file settings with defaults (flat schema)
      const result: SettingsDefaults = { ...this.DEFAULTS };
      for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
        if (flatSettings[key] !== undefined) {
          result[key] = flatSettings[key];
        }
      }

      return result;
    } catch (error) {
      console.warn('[SETTINGS] Failed to load settings, using defaults:', settingsPath, error);
      return this.getAllDefaults();
    }
  }

  /**
   * Get a secret from the OS keyring
   * Secrets are stored separately from settings.json for security
   *
   * @param key - The secret key (e.g., 'GEMINI_API_KEY', 'OPENROUTER_API_KEY')
   * @returns The secret value or empty string if not found
   */
  static async getSecret(key: string): Promise<string> {
    try {
      const value = await keyringManager.getSecret(key as any);
      return value || '';
    } catch (error) {
      console.warn('[SETTINGS] Failed to retrieve secret from keyring:', key, error);
      return '';
    }
  }

  /**
   * Set a secret in the OS keyring
   * Secrets are stored separately from settings.json for security
   *
   * @param key - The secret key (e.g., 'GEMINI_API_KEY', 'OPENROUTER_API_KEY')
   * @param value - The secret value to store
   * @returns True if stored successfully
   */
  static async setSecret(key: string, value: string): Promise<boolean> {
    try {
      return await keyringManager.setSecret(key as any, value);
    } catch (error) {
      console.warn('[SETTINGS] Failed to store secret in keyring:', key, error);
      return false;
    }
  }

  /**
   * Migrate API keys from settings.json to OS keyring
   * This should be called once on startup to move secrets to secure storage
   *
   * @param settingsPath - Path to settings.json file
   * @returns True if migration completed (even if no keys were found)
   */
  static async migrateSecretsToKeyring(settingsPath: string): Promise<boolean> {
    try {
      if (!existsSync(settingsPath)) {
        // No settings file exists yet, nothing to migrate
        return true;
      }

      const settingsData = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsData);

      let modified = false;
      const secretKeys = [
        { oldKey: 'CLAUDE_MEM_GEMINI_API_KEY', newKey: 'GEMINI_API_KEY' },
        { oldKey: 'CLAUDE_MEM_OPENROUTER_API_KEY', newKey: 'OPENROUTER_API_KEY' }
      ];

      for (const { oldKey, newKey } of secretKeys) {
        const value = settings[oldKey];
        if (value && typeof value === 'string' && value.trim() !== '') {
          // Move to keyring
          const success = await keyringManager.setSecret(newKey as any, value);
          if (success) {
            console.log(`[SETTINGS] Migrated ${oldKey} to OS keyring`);
            // Remove from settings.json
            delete settings[oldKey];
            modified = true;
          } else {
            console.warn(`[SETTINGS] Failed to migrate ${oldKey} to keyring, keeping in settings.json`);
          }
        }
      }

      // Write back to file if we removed any keys
      if (modified) {
        try {
          writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
          console.log('[SETTINGS] Secrets migration complete, settings.json updated');
        } catch (error) {
          console.warn('[SETTINGS] Failed to update settings.json after migration:', error);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.warn('[SETTINGS] Secret migration failed:', error);
      return false;
    }
  }
}
