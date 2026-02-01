/**
 * KeyringManager - OS Keyring Abstraction Layer
 *
 * Provides secure storage for sensitive credentials using the operating system's keyring.
 * Falls back to environment variables when keyring is unavailable (e.g., headless servers).
 *
 * Supported secret keys:
 * - GEMINI_API_KEY
 * - OPENROUTER_API_KEY
 * - DB_ENCRYPTION_KEY
 * - AUTH_TOKEN
 */

import { logger } from '../../utils/logger.js';

const SERVICE_NAME = 'claude-mem';

export type SecretKey =
  | 'GEMINI_API_KEY'
  | 'OPENROUTER_API_KEY'
  | 'DB_ENCRYPTION_KEY'
  | 'AUTH_TOKEN';

/**
 * KeyringManager provides cross-platform secure credential storage
 */
export class KeyringManager {
  private keytar: any | null = null;
  private keytarAvailable: boolean = false;
  private initialized: boolean = false;

  /**
   * Initialize keytar module (lazy-loaded)
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    try {
      // Try to dynamically import keytar
      // Note: keytar is a native module that needs to be installed separately
      this.keytar = await import('keytar');
      this.keytarAvailable = true;
      logger.info('SYSTEM', 'KeyringManager initialized with OS keyring support');
    } catch (error) {
      this.keytarAvailable = false;
      logger.warn('SYSTEM', 'Keyring not available, falling back to environment variables', undefined, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Store a secret in the OS keyring or environment
   *
   * @param key - The secret key identifier
   * @param value - The secret value to store
   * @returns True if stored successfully
   */
  async setSecret(key: SecretKey, value: string): Promise<boolean> {
    await this.initialize();

    if (!value) {
      logger.warn('SYSTEM', `Attempted to store empty secret for ${key}`);
      return false;
    }

    try {
      if (this.keytarAvailable && this.keytar) {
        await this.keytar.setPassword(SERVICE_NAME, key, value);
        logger.info('SYSTEM', `Secret stored in OS keyring: ${key}`);
        return true;
      } else {
        // Fallback: warn that secrets should be set via environment variables
        logger.warn('SYSTEM', `Keyring unavailable. Set ${key} via environment variable instead`);
        return false;
      }
    } catch (error) {
      logger.error('SYSTEM', `Failed to store secret: ${key}`, undefined, error);
      return false;
    }
  }

  /**
   * Retrieve a secret from the OS keyring or environment
   *
   * Priority:
   * 1. OS Keyring (if available)
   * 2. Environment variable
   *
   * @param key - The secret key identifier
   * @returns The secret value or null if not found
   */
  async getSecret(key: SecretKey): Promise<string | null> {
    await this.initialize();

    try {
      // Try keyring first
      if (this.keytarAvailable && this.keytar) {
        const value = await this.keytar.getPassword(SERVICE_NAME, key);
        if (value) {
          logger.debug('SYSTEM', `Secret retrieved from OS keyring: ${key}`);
          return value;
        }
      }

      // Fallback to environment variable
      const envValue = process.env[key];
      if (envValue) {
        logger.debug('SYSTEM', `Secret retrieved from environment: ${key}`);
        return envValue;
      }

      logger.debug('SYSTEM', `Secret not found: ${key}`);
      return null;
    } catch (error) {
      logger.error('SYSTEM', `Failed to retrieve secret: ${key}`, undefined, error);
      return null;
    }
  }

  /**
   * Delete a secret from the OS keyring
   *
   * Note: Does not clear environment variables
   *
   * @param key - The secret key identifier
   * @returns True if deleted successfully
   */
  async deleteSecret(key: SecretKey): Promise<boolean> {
    await this.initialize();

    try {
      if (this.keytarAvailable && this.keytar) {
        const result = await this.keytar.deletePassword(SERVICE_NAME, key);
        if (result) {
          logger.info('SYSTEM', `Secret deleted from OS keyring: ${key}`);
        } else {
          logger.debug('SYSTEM', `Secret not found in OS keyring: ${key}`);
        }
        return result;
      } else {
        logger.warn('SYSTEM', `Keyring unavailable. Cannot delete secret: ${key}`);
        return false;
      }
    } catch (error) {
      logger.error('SYSTEM', `Failed to delete secret: ${key}`, undefined, error);
      return false;
    }
  }

  /**
   * Check if a secret exists in the keyring or environment
   *
   * @param key - The secret key identifier
   * @returns True if the secret exists
   */
  async hasSecret(key: SecretKey): Promise<boolean> {
    await this.initialize();

    try {
      // Check keyring first
      if (this.keytarAvailable && this.keytar) {
        const value = await this.keytar.getPassword(SERVICE_NAME, key);
        if (value) {
          return true;
        }
      }

      // Check environment variable
      if (process.env[key]) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error('SYSTEM', `Failed to check secret existence: ${key}`, undefined, error);
      return false;
    }
  }

  /**
   * Check if OS keyring is available
   *
   * @returns True if keyring is available
   */
  async isKeytarAvailable(): Promise<boolean> {
    await this.initialize();
    return this.keytarAvailable;
  }

  /**
   * List all stored secret keys (for debugging/admin purposes)
   *
   * @returns Array of secret keys that are currently stored
   */
  async listSecrets(): Promise<SecretKey[]> {
    await this.initialize();

    const availableSecrets: SecretKey[] = [];
    const allKeys: SecretKey[] = [
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'DB_ENCRYPTION_KEY',
      'AUTH_TOKEN'
    ];

    for (const key of allKeys) {
      if (await this.hasSecret(key)) {
        availableSecrets.push(key);
      }
    }

    return availableSecrets;
  }
}

// Export singleton instance
export const keyringManager = new KeyringManager();
