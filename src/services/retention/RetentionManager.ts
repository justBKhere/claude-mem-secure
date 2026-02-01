/**
 * RetentionManager - User-configurable data retention
 *
 * Provides methods for cleaning up old data based on user-configured retention policies.
 * Supports:
 * - Archiving data before deletion
 * - Configurable retention days (0 = keep forever)
 * - Safe, idempotent cleanup operations
 * - Stats about data age distribution
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { ARCHIVES_DIR, ensureDir, USER_SETTINGS_PATH } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { SessionStore } from '../sqlite/SessionStore.js';

export interface RetentionStats {
  totalObservations: number;
  totalSummaries: number;
  totalPrompts: number;
  oldestObservationDate: string | null;
  newestObservationDate: string | null;
  observationsOlderThanRetention: number;
  summariesOlderThanRetention: number;
  promptsOlderThanRetention: number;
}

export interface ArchivedData {
  archivedAt: string;
  retentionDays: number;
  cutoffDate: string;
  sessions: any[];
  observations: any[];
  summaries: any[];
  prompts: any[];
}

export class RetentionManager {
  private sessionStore: SessionStore;

  constructor(sessionStore: SessionStore) {
    this.sessionStore = sessionStore;
  }

  /**
   * Get retention settings from SettingsDefaultsManager
   */
  private getRetentionSettings(): {
    enabled: boolean;
    retentionDays: number;
    archiveBeforeDelete: boolean;
    archivePath: string;
  } {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    return {
      enabled: settings.CLAUDE_MEM_RETENTION_ENABLED === 'true',
      retentionDays: parseInt(settings.CLAUDE_MEM_RETENTION_DAYS, 10) || 90,
      archiveBeforeDelete: settings.CLAUDE_MEM_ARCHIVE_BEFORE_DELETE === 'true',
      archivePath: settings.CLAUDE_MEM_ARCHIVE_PATH || join(ARCHIVES_DIR, 'retention')
    };
  }

  /**
   * Calculate cutoff date based on retention days
   */
  private getCutoffDate(retentionDays: number): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    cutoff.setHours(0, 0, 0, 0); // Start of day
    return cutoff;
  }

  /**
   * Get retention statistics
   * Shows distribution of data age and counts what would be affected by cleanup
   */
  async getRetentionStats(): Promise<RetentionStats> {
    const settings = this.getRetentionSettings();
    const cutoffEpoch = settings.retentionDays > 0
      ? this.getCutoffDate(settings.retentionDays).getTime()
      : 0;

    // Get total counts
    const totalObservations = this.sessionStore.db.prepare(
      'SELECT COUNT(*) as count FROM observations'
    ).get() as { count: number };

    const totalSummaries = this.sessionStore.db.prepare(
      'SELECT COUNT(*) as count FROM session_summaries'
    ).get() as { count: number };

    const totalPrompts = this.sessionStore.db.prepare(
      'SELECT COUNT(*) as count FROM user_prompts'
    ).get() as { count: number };

    // Get oldest and newest observation dates
    const oldestObs = this.sessionStore.db.prepare(
      'SELECT created_at FROM observations ORDER BY created_at_epoch ASC LIMIT 1'
    ).get() as { created_at: string } | undefined;

    const newestObs = this.sessionStore.db.prepare(
      'SELECT created_at FROM observations ORDER BY created_at_epoch DESC LIMIT 1'
    ).get() as { created_at: string } | undefined;

    // Count old records (only if retention is enabled and not forever)
    let observationsOlderThanRetention = 0;
    let summariesOlderThanRetention = 0;
    let promptsOlderThanRetention = 0;

    if (settings.enabled && settings.retentionDays > 0) {
      observationsOlderThanRetention = (this.sessionStore.db.prepare(
        'SELECT COUNT(*) as count FROM observations WHERE created_at_epoch < ?'
      ).get(cutoffEpoch) as { count: number }).count;

      summariesOlderThanRetention = (this.sessionStore.db.prepare(
        'SELECT COUNT(*) as count FROM session_summaries WHERE created_at_epoch < ?'
      ).get(cutoffEpoch) as { count: number }).count;

      promptsOlderThanRetention = (this.sessionStore.db.prepare(
        'SELECT COUNT(*) as count FROM user_prompts WHERE created_at_epoch < ?'
      ).get(cutoffEpoch) as { count: number }).count;
    }

    return {
      totalObservations: totalObservations.count,
      totalSummaries: totalSummaries.count,
      totalPrompts: totalPrompts.count,
      oldestObservationDate: oldestObs?.created_at ?? null,
      newestObservationDate: newestObs?.created_at ?? null,
      observationsOlderThanRetention,
      summariesOlderThanRetention,
      promptsOlderThanRetention
    };
  }

  /**
   * Archive old data to JSON files
   * Returns path to archive file
   */
  async archiveOldData(cutoffDate: Date): Promise<string | null> {
    const cutoffEpoch = cutoffDate.getTime();
    const settings = this.getRetentionSettings();

    try {
      // Get all old data
      const oldObservations = this.sessionStore.db.prepare(
        'SELECT * FROM observations WHERE created_at_epoch < ? ORDER BY created_at_epoch ASC'
      ).all(cutoffEpoch);

      const oldSummaries = this.sessionStore.db.prepare(
        'SELECT * FROM session_summaries WHERE created_at_epoch < ? ORDER BY created_at_epoch ASC'
      ).all(cutoffEpoch);

      const oldPrompts = this.sessionStore.db.prepare(
        'SELECT * FROM user_prompts WHERE created_at_epoch < ? ORDER BY created_at_epoch ASC'
      ).all(cutoffEpoch);

      // Get sessions associated with old data
      const oldSessionIds = new Set<string>();
      (oldObservations as any[]).forEach(obs => {
        if (obs.memory_session_id) oldSessionIds.add(obs.memory_session_id);
      });
      (oldSummaries as any[]).forEach(sum => {
        if (sum.memory_session_id) oldSessionIds.add(sum.memory_session_id);
      });

      const oldSessions = Array.from(oldSessionIds).map(sessionId => {
        return this.sessionStore.db.prepare(
          'SELECT * FROM sdk_sessions WHERE memory_session_id = ?'
        ).get(sessionId);
      }).filter(Boolean);

      // Nothing to archive
      if (oldObservations.length === 0 && oldSummaries.length === 0 && oldPrompts.length === 0) {
        logger.info('SYSTEM', 'No data to archive', {
          cutoffDate: cutoffDate.toISOString(),
          retentionDays: settings.retentionDays
        });
        return null;
      }

      // Create archive
      const archiveData: ArchivedData = {
        archivedAt: new Date().toISOString(),
        retentionDays: settings.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        sessions: oldSessions,
        observations: oldObservations,
        summaries: oldSummaries,
        prompts: oldPrompts
      };

      // Ensure archive directory exists
      ensureDir(settings.archivePath);

      // Create archive filename with timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
      const archiveFilePath = join(
        settings.archivePath,
        `retention-archive-${timestamp}.json`
      );

      // Write archive file
      writeFileSync(archiveFilePath, JSON.stringify(archiveData, null, 2), 'utf-8');

      logger.info('SYSTEM', 'Data archived successfully', {
        archiveFile: archiveFilePath,
        observations: oldObservations.length,
        summaries: oldSummaries.length,
        prompts: oldPrompts.length,
        sessions: oldSessions.length
      });

      return archiveFilePath;
    } catch (error) {
      logger.error('SYSTEM', 'Failed to archive old data', {}, error as Error);
      return null;
    }
  }

  /**
   * Delete old data from database
   * Returns counts of deleted records
   */
  async deleteOldData(cutoffDate: Date): Promise<{
    observationsDeleted: number;
    summariesDeleted: number;
    promptsDeleted: number;
    sessionsDeleted: number;
  }> {
    const cutoffEpoch = cutoffDate.getTime();

    try {
      // Begin transaction
      this.sessionStore.db.run('BEGIN TRANSACTION');

      // Delete old observations
      const obsResult = this.sessionStore.db.prepare(
        'DELETE FROM observations WHERE created_at_epoch < ?'
      ).run(cutoffEpoch);

      // Delete old summaries
      const sumResult = this.sessionStore.db.prepare(
        'DELETE FROM session_summaries WHERE created_at_epoch < ?'
      ).run(cutoffEpoch);

      // Delete old prompts
      const promptResult = this.sessionStore.db.prepare(
        'DELETE FROM user_prompts WHERE created_at_epoch < ?'
      ).run(cutoffEpoch);

      // Delete sessions that have no more data
      // A session should be deleted if all its observations, summaries, and prompts are gone
      const sessionResult = this.sessionStore.db.prepare(`
        DELETE FROM sdk_sessions
        WHERE id IN (
          SELECT s.id FROM sdk_sessions s
          WHERE s.started_at_epoch < ?
          AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.memory_session_id = s.memory_session_id)
          AND NOT EXISTS (SELECT 1 FROM session_summaries ss WHERE ss.memory_session_id = s.memory_session_id)
          AND NOT EXISTS (SELECT 1 FROM user_prompts up WHERE up.content_session_id = s.content_session_id)
        )
      `).run(cutoffEpoch);

      // Commit transaction
      this.sessionStore.db.run('COMMIT');

      const result = {
        observationsDeleted: obsResult.changes,
        summariesDeleted: sumResult.changes,
        promptsDeleted: promptResult.changes,
        sessionsDeleted: sessionResult.changes
      };

      logger.info('SYSTEM', 'Old data deleted successfully', {
        cutoffDate: cutoffDate.toISOString(),
        ...result
      });

      return result;
    } catch (error) {
      // Rollback on error
      this.sessionStore.db.run('ROLLBACK');
      logger.error('SYSTEM', 'Failed to delete old data', {}, error as Error);
      throw error;
    }
  }

  /**
   * Run cleanup based on retention policy
   * This is the main entry point called by worker-service
   */
  async runCleanup(): Promise<void> {
    try {
      const settings = this.getRetentionSettings();

      // Check if retention is enabled
      if (!settings.enabled) {
        logger.debug('SYSTEM', 'Retention cleanup skipped (disabled in settings)');
        return;
      }

      // Check if retention is set to forever (0 days)
      if (settings.retentionDays === 0) {
        logger.debug('SYSTEM', 'Retention cleanup skipped (retention set to forever)');
        return;
      }

      const cutoffDate = this.getCutoffDate(settings.retentionDays);

      logger.info('SYSTEM', 'Running retention cleanup', {
        enabled: settings.enabled,
        retentionDays: settings.retentionDays,
        archiveBeforeDelete: settings.archiveBeforeDelete,
        cutoffDate: cutoffDate.toISOString()
      });

      // Get stats before cleanup
      const statsBefore = await this.getRetentionStats();

      // Nothing to clean up
      if (
        statsBefore.observationsOlderThanRetention === 0 &&
        statsBefore.summariesOlderThanRetention === 0 &&
        statsBefore.promptsOlderThanRetention === 0
      ) {
        logger.info('SYSTEM', 'No old data to clean up', {
          retentionDays: settings.retentionDays,
          cutoffDate: cutoffDate.toISOString()
        });
        return;
      }

      // Archive data if enabled
      if (settings.archiveBeforeDelete) {
        const archivePath = await this.archiveOldData(cutoffDate);
        if (!archivePath) {
          logger.warn('SYSTEM', 'Archiving failed, skipping deletion for safety');
          return;
        }
      }

      // Delete old data
      const deleteResult = await this.deleteOldData(cutoffDate);

      logger.info('SYSTEM', 'Retention cleanup completed', {
        retentionDays: settings.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        archived: settings.archiveBeforeDelete,
        ...deleteResult
      });
    } catch (error) {
      logger.error('SYSTEM', 'Retention cleanup failed', {}, error as Error);
      // Don't throw - we want cleanup to be non-blocking
    }
  }

  /**
   * Update retention days setting
   * Writes to settings.json
   */
  async setRetentionDays(days: number): Promise<boolean> {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
      settings.CLAUDE_MEM_RETENTION_DAYS = days.toString();

      // Write settings back to file
      ensureDir(join(USER_SETTINGS_PATH, '..'));
      writeFileSync(USER_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');

      logger.info('SYSTEM', 'Retention days updated', { retentionDays: days });
      return true;
    } catch (error) {
      logger.error('SYSTEM', 'Failed to update retention days', {}, error as Error);
      return false;
    }
  }
}

/**
 * Singleton instance for global access
 * Note: Must be initialized with a SessionStore instance before use
 */
let retentionManagerInstance: RetentionManager | null = null;

export function initializeRetentionManager(sessionStore: SessionStore): RetentionManager {
  retentionManagerInstance = new RetentionManager(sessionStore);
  return retentionManagerInstance;
}

export function getRetentionManager(): RetentionManager {
  if (!retentionManagerInstance) {
    throw new Error('RetentionManager not initialized. Call initializeRetentionManager() first.');
  }
  return retentionManagerInstance;
}

// Export a default instance getter (will throw if not initialized)
export const retentionManager = {
  get instance(): RetentionManager {
    return getRetentionManager();
  }
};
