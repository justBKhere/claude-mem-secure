/**
 * TokenAuth - API Authentication Token Management
 *
 * Provides secure token-based authentication for the Worker Service API.
 * Tokens are generated using crypto.randomBytes and stored in the OS keyring.
 *
 * Features:
 * - Generate secure 32-byte random tokens
 * - Store tokens in OS keyring via KeyringManager
 * - Validate bearer tokens
 * - Regenerate tokens (invalidates old token)
 * - Display masked tokens for user reference
 */

import crypto from 'crypto';
import { keyringManager } from '../crypto/KeyringManager.js';
import { logger } from '../../utils/logger.js';

/**
 * TokenAuth manages API authentication tokens
 */
export class TokenAuth {
  private readonly TOKEN_BYTES = 32;

  /**
   * Get existing token or create a new one
   *
   * @returns The authentication token
   */
  async getOrCreateToken(): Promise<string> {
    // Try to get existing token from keyring
    const existingToken = await keyringManager.getSecret('AUTH_TOKEN');
    if (existingToken) {
      logger.debug('AUTH', 'Retrieved existing auth token from keyring');
      return existingToken;
    }

    // Generate new token
    logger.info('AUTH', 'No existing auth token found, generating new token');
    const newToken = await this.generateToken();

    // Store in keyring
    const stored = await keyringManager.setSecret('AUTH_TOKEN', newToken);
    if (!stored) {
      logger.warn('AUTH', 'Failed to store auth token in keyring, token will not persist');
    }

    return newToken;
  }

  /**
   * Validate a provided token against the stored token
   *
   * @param token - The token to validate
   * @returns True if the token is valid
   */
  async validateToken(token: string): Promise<boolean> {
    if (!token) {
      logger.debug('AUTH', 'Token validation failed: empty token');
      return false;
    }

    const storedToken = await keyringManager.getSecret('AUTH_TOKEN');
    if (!storedToken) {
      logger.warn('AUTH', 'Token validation failed: no stored token found');
      return false;
    }

    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(token),
      Buffer.from(storedToken)
    );

    if (!isValid) {
      logger.debug('AUTH', 'Token validation failed: token mismatch');
    }

    return isValid;
  }

  /**
   * Regenerate the authentication token
   * This invalidates the old token
   *
   * @returns The new authentication token
   */
  async regenerateToken(): Promise<string> {
    logger.info('AUTH', 'Regenerating authentication token');

    const newToken = await this.generateToken();
    const stored = await keyringManager.setSecret('AUTH_TOKEN', newToken);

    if (!stored) {
      logger.warn('AUTH', 'Failed to store regenerated token in keyring');
    }

    return newToken;
  }

  /**
   * Get a masked version of the token for display purposes
   * Shows first 8 characters followed by "..."
   *
   * @returns Masked token or null if no token exists
   */
  async getTokenForDisplay(): Promise<string | null> {
    const token = await keyringManager.getSecret('AUTH_TOKEN');
    if (!token) {
      return null;
    }

    if (token.length <= 8) {
      return token; // Token too short to mask
    }

    return `${token.substring(0, 8)}...`;
  }

  /**
   * Generate a new secure random token
   * Uses crypto.randomBytes to generate a 32-byte random token
   *
   * @returns The generated token as a hex string
   */
  private async generateToken(): Promise<string> {
    const buffer = crypto.randomBytes(this.TOKEN_BYTES);
    return buffer.toString('hex');
  }
}

// Export singleton instance
export const tokenAuth = new TokenAuth();
