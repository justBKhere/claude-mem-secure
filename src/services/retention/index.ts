/**
 * Retention module - Exports retention management functionality
 */

export {
  RetentionManager,
  initializeRetentionManager,
  getRetentionManager,
  retentionManager
} from './RetentionManager.js';

export type {
  RetentionStats,
  ArchivedData
} from './RetentionManager.js';
