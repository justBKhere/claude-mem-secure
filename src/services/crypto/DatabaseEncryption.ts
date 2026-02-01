/**
 * DatabaseEncryption - SQLCipher Key Management
 *
 * Manages encryption keys for SQLite databases using SQLCipher.
 * Generates secure random keys and stores them in the OS keyring.
 *
 * Key lifecycle:
 * 1. On first run: Generate a secure random encryption key
 * 2. Store key in OS keyring via KeyringManager
 * 3. Retrieve key on subsequent runs
 * 4. Support key rotation (generate new key, re-encrypt database)
 */

import { randomBytes } from 'crypto';
import { logger } from '../../utils/logger.js';
import { keyringManager, type SecretKey } from './KeyringManager.js';

const DB_KEY_LENGTH = 32; // 256 bits
const ENCRYPTION_KEY_NAME: SecretKey = 'DB_ENCRYPTION_KEY';

export class DatabaseEncryption {
  /**
   * Get or create the database encryption key
   *
   * If no key exists, generates a new one and stores it securely.
   *
   * @returns The encryption key as a hex string
   * @throws Error if key cannot be generated or retrieved
   */
  async getOrCreateEncryptionKey(): Promise<string> {
    try {
      // Try to retrieve existing key
      const existingKey = await keyringManager.getSecret(ENCRYPTION_KEY_NAME);

      if (existingKey) {
        logger.debug('SYSTEM', 'Retrieved existing database encryption key');
        return existingKey;
      }

      // No existing key - generate a new one
      logger.info('SYSTEM', 'No encryption key found, generating new key');
      const newKey = this.generateEncryptionKey();

      // Store the new key
      const stored = await keyringManager.setSecret(ENCRYPTION_KEY_NAME, newKey);

      if (!stored) {
        // Keyring not available - in production, this should fail
        // For headless servers, consider using an encrypted file or HSM
        logger.warn('SYSTEM', 'Failed to store encryption key in keyring. Using generated key for this session only.');

        // For development/testing: return the key but warn
        // For production: throw new Error('Cannot store encryption key securely');
        return newKey;
      }

      logger.info('SYSTEM', 'Generated and stored new database encryption key');
      return newKey;
    } catch (error) {
      logger.error('SYSTEM', 'Failed to get or create encryption key', undefined, error);
      throw new Error('Database encryption key unavailable');
    }
  }

  /**
   * Generate a cryptographically secure random encryption key
   *
   * @returns Hex-encoded encryption key
   */
  private generateEncryptionKey(): string {
    const keyBuffer = randomBytes(DB_KEY_LENGTH);
    const hexKey = keyBuffer.toString('hex');

    logger.debug('SYSTEM', `Generated ${DB_KEY_LENGTH * 8}-bit encryption key`);
    return hexKey;
  }

  /**
   * Rotate the database encryption key
   *
   * This operation:
   * 1. Generates a new encryption key
   * 2. Returns both old and new keys for database re-encryption
   * 3. Updates the stored key only after successful re-encryption
   *
   * Note: The caller is responsible for re-encrypting the database
   * and calling confirmKeyRotation() after successful re-encryption.
   *
   * @returns Object containing old and new keys
   * @throws Error if current key cannot be retrieved
   */
  async rotateEncryptionKey(): Promise<{ oldKey: string; newKey: string }> {
    try {
      // Get current key
      const oldKey = await keyringManager.getSecret(ENCRYPTION_KEY_NAME);

      if (!oldKey) {
        throw new Error('No existing encryption key found - cannot rotate');
      }

      // Generate new key
      const newKey = this.generateEncryptionKey();

      logger.info('SYSTEM', 'Generated new encryption key for rotation (not yet stored)');

      return { oldKey, newKey };
    } catch (error) {
      logger.error('SYSTEM', 'Failed to rotate encryption key', undefined, error);
      throw error;
    }
  }

  /**
   * Confirm key rotation after successful database re-encryption
   *
   * This should only be called after the database has been successfully
   * re-encrypted with the new key.
   *
   * @param newKey - The new encryption key to store
   * @returns True if the new key was stored successfully
   */
  async confirmKeyRotation(newKey: string): Promise<boolean> {
    try {
      const stored = await keyringManager.setSecret(ENCRYPTION_KEY_NAME, newKey);

      if (stored) {
        logger.info('SYSTEM', 'Key rotation confirmed - new key stored');
      } else {
        logger.error('SYSTEM', 'Failed to store new encryption key after rotation');
      }

      return stored;
    } catch (error) {
      logger.error('SYSTEM', 'Failed to confirm key rotation', undefined, error);
      return false;
    }
  }

  /**
   * Delete the stored encryption key
   *
   * WARNING: This will make the encrypted database permanently inaccessible
   * unless the key is backed up elsewhere.
   *
   * @returns True if the key was deleted successfully
   */
  async deleteEncryptionKey(): Promise<boolean> {
    try {
      const deleted = await keyringManager.deleteSecret(ENCRYPTION_KEY_NAME);

      if (deleted) {
        logger.warn('SYSTEM', 'Database encryption key deleted - encrypted database is now inaccessible');
      } else {
        logger.debug('SYSTEM', 'No encryption key found to delete');
      }

      return deleted;
    } catch (error) {
      logger.error('SYSTEM', 'Failed to delete encryption key', undefined, error);
      return false;
    }
  }

  /**
   * Check if an encryption key exists
   *
   * @returns True if an encryption key is available
   */
  async hasEncryptionKey(): Promise<boolean> {
    try {
      return await keyringManager.hasSecret(ENCRYPTION_KEY_NAME);
    } catch (error) {
      logger.error('SYSTEM', 'Failed to check for encryption key', undefined, error);
      return false;
    }
  }

  /**
   * Validate that a key is properly formatted
   *
   * @param key - The key to validate
   * @returns True if the key is valid
   */
  validateKey(key: string): boolean {
    // Key should be a hex string of the correct length
    const expectedLength = DB_KEY_LENGTH * 2; // Hex encoding doubles the length

    if (key.length !== expectedLength) {
      logger.warn('SYSTEM', `Invalid key length: expected ${expectedLength}, got ${key.length}`);
      return false;
    }

    if (!/^[0-9a-fA-F]+$/.test(key)) {
      logger.warn('SYSTEM', 'Invalid key format: not a valid hex string');
      return false;
    }

    return true;
  }
}

// Export singleton instance
export const databaseEncryption = new DatabaseEncryption();
