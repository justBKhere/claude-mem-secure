/**
 * File Permission Hardening Utility for claude-mem-secure
 * Provides functions to ensure sensitive files have secure permissions (owner-only access)
 * Works on Linux and macOS, gracefully handles Windows with warnings
 */

import { existsSync, mkdirSync, statSync, chmodSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { logger } from './logger.js';

const COMPONENT = 'SYSTEM';
const DEFAULT_DATA_DIR = join(homedir(), '.claude-mem');

/**
 * Check if we're running on Windows
 */
function isWindows(): boolean {
  return platform() === 'win32';
}

/**
 * Set secure permissions on a file (0o600 - owner read/write only)
 * On Windows, logs a warning and returns true (no-op)
 *
 * @param filePath - Absolute path to the file
 * @returns true if permissions were set successfully, false otherwise
 */
export function setSecurePermissions(filePath: string): boolean {
  try {
    // Windows: Log warning and skip
    if (isWindows()) {
      logger.warn(
        COMPONENT,
        'File permission hardening not available on Windows',
        undefined,
        { filePath }
      );
      return true;
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      logger.error(
        COMPONENT,
        'Cannot set permissions: file does not exist',
        undefined,
        { filePath }
      );
      return false;
    }

    // Set permissions to 0o600 (owner read/write only)
    chmodSync(filePath, 0o600);

    logger.debug(
      COMPONENT,
      'Set secure permissions (0o600) on file',
      undefined,
      { filePath }
    );

    return true;
  } catch (error) {
    logger.error(
      COMPONENT,
      'Failed to set secure permissions',
      undefined,
      { filePath, error: error instanceof Error ? error.message : String(error) }
    );
    return false;
  }
}

/**
 * Check if a file has secure permissions (not world or group readable)
 * On Windows, always returns true (no-op)
 *
 * @param filePath - Absolute path to the file
 * @returns true if file has secure permissions, false otherwise
 */
export function checkPermissions(filePath: string): boolean {
  try {
    // Windows: Always return true
    if (isWindows()) {
      return true;
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      logger.error(
        COMPONENT,
        'Cannot check permissions: file does not exist',
        undefined,
        { filePath }
      );
      return false;
    }

    // Get file stats
    const stats = statSync(filePath);
    const mode = stats.mode;

    // Extract permission bits (last 9 bits)
    // 0o777 = 0b111111111 (rwxrwxrwx)
    // We want to check if group (bits 3-5) or world (bits 0-2) have read access
    const groupRead = (mode & 0o040) !== 0; // Group read bit
    const worldRead = (mode & 0o004) !== 0; // World read bit

    if (groupRead || worldRead) {
      logger.warn(
        COMPONENT,
        'File has insecure permissions (group or world readable)',
        undefined,
        {
          filePath,
          mode: '0o' + (mode & 0o777).toString(8),
          groupReadable: groupRead,
          worldReadable: worldRead
        }
      );
      return false;
    }

    logger.debug(
      COMPONENT,
      'File has secure permissions',
      undefined,
      { filePath, mode: '0o' + (mode & 0o777).toString(8) }
    );

    return true;
  } catch (error) {
    logger.error(
      COMPONENT,
      'Failed to check file permissions',
      undefined,
      { filePath, error: error instanceof Error ? error.message : String(error) }
    );
    return false;
  }
}

/**
 * Ensure a directory exists with secure permissions (0o700 - owner access only)
 * Creates the directory if it doesn't exist
 * On Windows, creates directory normally with a warning
 *
 * @param dirPath - Absolute path to the directory
 * @returns true if directory exists/was created with secure permissions, false otherwise
 */
export function ensureSecureDirectory(dirPath: string): boolean {
  try {
    // Check if directory already exists
    if (existsSync(dirPath)) {
      const stats = statSync(dirPath);

      if (!stats.isDirectory()) {
        logger.error(
          COMPONENT,
          'Path exists but is not a directory',
          undefined,
          { dirPath }
        );
        return false;
      }

      // On non-Windows, check and fix permissions if needed
      if (!isWindows()) {
        const mode = stats.mode;
        const groupAccess = (mode & 0o070) !== 0; // Group rwx bits
        const worldAccess = (mode & 0o007) !== 0; // World rwx bits

        if (groupAccess || worldAccess) {
          logger.warn(
            COMPONENT,
            'Directory has insecure permissions, fixing',
            undefined,
            {
              dirPath,
              oldMode: '0o' + (mode & 0o777).toString(8)
            }
          );
          chmodSync(dirPath, 0o700);
        }
      }

      logger.debug(
        COMPONENT,
        'Directory exists with secure permissions',
        undefined,
        { dirPath }
      );

      return true;
    }

    // Create directory with secure permissions
    if (isWindows()) {
      // Windows: Create normally and log warning
      mkdirSync(dirPath, { recursive: true });
      logger.warn(
        COMPONENT,
        'Created directory on Windows (permission hardening not available)',
        undefined,
        { dirPath }
      );
    } else {
      // Unix: Create with mode 0o700
      mkdirSync(dirPath, { recursive: true, mode: 0o700 });
      logger.info(
        COMPONENT,
        'Created directory with secure permissions (0o700)',
        undefined,
        { dirPath }
      );
    }

    return true;
  } catch (error) {
    logger.error(
      COMPONENT,
      'Failed to ensure secure directory',
      undefined,
      { dirPath, error: error instanceof Error ? error.message : String(error) }
    );
    return false;
  }
}

/**
 * Apply secure permissions to all sensitive files in ~/.claude-mem/
 * Hardens:
 * - claude-mem.db (SQLite database)
 * - settings.json (configuration file)
 * - All files in logs/ directory
 * - All files in chroma/ directory (if exists)
 *
 * On Windows, logs warnings and returns true (no-op)
 *
 * @param dataDir - Optional custom data directory (defaults to ~/.claude-mem)
 * @returns true if all permissions were set successfully, false if any failed
 */
export function hardenDataDirectory(dataDir: string = DEFAULT_DATA_DIR): boolean {
  try {
    logger.info(
      COMPONENT,
      'Hardening data directory permissions',
      undefined,
      { dataDir }
    );

    // Windows: Log warning and return early
    if (isWindows()) {
      logger.warn(
        COMPONENT,
        'Data directory hardening not available on Windows',
        undefined,
        { dataDir }
      );
      return true;
    }

    // Check if data directory exists
    if (!existsSync(dataDir)) {
      logger.warn(
        COMPONENT,
        'Data directory does not exist, nothing to harden',
        undefined,
        { dataDir }
      );
      return true;
    }

    let allSuccessful = true;

    // Harden the data directory itself
    if (!ensureSecureDirectory(dataDir)) {
      allSuccessful = false;
    }

    // Sensitive files to harden
    const sensitiveFiles = [
      join(dataDir, 'claude-mem.db'),
      join(dataDir, 'settings.json')
    ];

    for (const filePath of sensitiveFiles) {
      if (existsSync(filePath)) {
        if (!setSecurePermissions(filePath)) {
          allSuccessful = false;
        }
      } else {
        logger.debug(
          COMPONENT,
          'Sensitive file does not exist yet, skipping',
          undefined,
          { filePath }
        );
      }
    }

    // Harden logs directory and all log files
    const logsDir = join(dataDir, 'logs');
    if (existsSync(logsDir)) {
      if (!ensureSecureDirectory(logsDir)) {
        allSuccessful = false;
      }

      // Harden all log files
      try {
        const logFiles = readdirSync(logsDir);
        for (const logFile of logFiles) {
          const logFilePath = join(logsDir, logFile);
          const stats = statSync(logFilePath);

          if (stats.isFile()) {
            if (!setSecurePermissions(logFilePath)) {
              allSuccessful = false;
            }
          }
        }
      } catch (error) {
        logger.error(
          COMPONENT,
          'Failed to harden log files',
          undefined,
          { logsDir, error: error instanceof Error ? error.message : String(error) }
        );
        allSuccessful = false;
      }
    }

    // Harden chroma directory and contents (if exists)
    const chromaDir = join(dataDir, 'chroma');
    if (existsSync(chromaDir)) {
      if (!ensureSecureDirectory(chromaDir)) {
        allSuccessful = false;
      }

      // Recursively harden chroma directory contents
      if (!hardenDirectoryRecursive(chromaDir)) {
        allSuccessful = false;
      }
    }

    if (allSuccessful) {
      logger.success(
        COMPONENT,
        'Successfully hardened all data directory permissions',
        undefined,
        { dataDir }
      );
    } else {
      logger.warn(
        COMPONENT,
        'Data directory hardening completed with some errors',
        undefined,
        { dataDir }
      );
    }

    return allSuccessful;
  } catch (error) {
    logger.error(
      COMPONENT,
      'Failed to harden data directory',
      undefined,
      { dataDir, error: error instanceof Error ? error.message : String(error) }
    );
    return false;
  }
}

/**
 * Recursively apply secure permissions to a directory and all its contents
 * Internal helper function for hardenDataDirectory
 *
 * @param dirPath - Absolute path to directory
 * @returns true if all permissions were set successfully, false if any failed
 */
function hardenDirectoryRecursive(dirPath: string): boolean {
  try {
    let allSuccessful = true;

    const entries = readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Ensure directory has secure permissions
        if (!ensureSecureDirectory(fullPath)) {
          allSuccessful = false;
        }

        // Recurse into subdirectory
        if (!hardenDirectoryRecursive(fullPath)) {
          allSuccessful = false;
        }
      } else if (entry.isFile()) {
        // Set secure permissions on file
        if (!setSecurePermissions(fullPath)) {
          allSuccessful = false;
        }
      }
    }

    return allSuccessful;
  } catch (error) {
    logger.error(
      COMPONENT,
      'Failed to recursively harden directory',
      undefined,
      { dirPath, error: error instanceof Error ? error.message : String(error) }
    );
    return false;
  }
}
