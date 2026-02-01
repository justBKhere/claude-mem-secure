/**
 * Tag Stripping Utilities
 *
 * Implements the dual-tag system for meta-observation control:
 * 1. <claude-mem-context> - System-level tag for auto-injected observations
 *    (prevents recursive storage when context injection is active)
 * 2. <private> - User-level tag for manual privacy control
 *    (allows users to mark content they don't want persisted)
 * 3. <secret> - User-level tag for sensitive data redaction
 *    (replaces content with [REDACTED] instead of removing it entirely)
 *
 * EDGE PROCESSING PATTERN: Filter at hook layer before sending to worker/storage.
 * This keeps the worker service simple and follows one-way data stream.
 */

import { logger } from './logger.js';
import { SettingsDefaultsManager } from '../shared/SettingsDefaultsManager.js';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Maximum number of tags allowed in a single content block
 * This protects against ReDoS (Regular Expression Denial of Service) attacks
 * where malicious input with many nested/unclosed tags could cause catastrophic backtracking
 */
const MAX_TAG_COUNT = 100;

/**
 * Maximum allowed regex pattern length to prevent ReDoS attacks
 */
const MAX_PATTERN_LENGTH = 200;

/**
 * Maximum number of user-defined redaction patterns
 */
const MAX_CUSTOM_PATTERNS = 50;

/**
 * Default patterns for automatic secret redaction
 * These cover common sensitive data formats
 */
const DEFAULT_REDACTION_PATTERNS = [
  // API Keys (various formats)
  /\bsk-[a-zA-Z0-9]{20,}/g,                           // OpenAI-style API keys
  /\bapi_[a-zA-Z0-9]{20,}/g,                          // Generic API keys with api_ prefix
  /\bkey_[a-zA-Z0-9]{20,}/g,                          // Generic API keys with key_ prefix

  // Bearer tokens
  /\bBearer\s+[a-zA-Z0-9\-._~+\/]+=*/gi,              // Bearer tokens (case insensitive)

  // AWS credentials
  /\bAKIA[0-9A-Z]{16}\b/g,                            // AWS Access Key IDs
  /\b[A-Za-z0-9/+=]{40}\b(?=.*aws)/gi,                // AWS Secret Access Keys (with context)

  // Private keys (PEM format)
  /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,

  // Password patterns
  /(?:password|passwd|pwd)\s*[=:]\s*['"]?([^\s'"]+)['"]?/gi,

  // JWT tokens
  /\beyJ[a-zA-Z0-9\-._~+\/]+=*\.eyJ[a-zA-Z0-9\-._~+\/]+=*\.[a-zA-Z0-9\-._~+\/]+=*/g,

  // GitHub tokens
  /\bgh[pousr]_[a-zA-Z0-9]{36,}\b/g,

  // Generic tokens and secrets (high entropy strings)
  /\b(?:token|secret|auth)['"]?\s*[=:]\s*['"]?([a-zA-Z0-9\-._~+\/]{20,})['"]?/gi,
];

/**
 * Count total number of opening tags in content
 * Used for ReDoS protection before regex processing
 */
function countTags(content: string): number {
  const privateCount = (content.match(/<private>/g) || []).length;
  const contextCount = (content.match(/<claude-mem-context>/g) || []).length;
  const secretCount = (content.match(/<secret>/g) || []).length;
  return privateCount + contextCount + secretCount;
}

/**
 * Safely compile user-provided regex patterns with validation
 * @param patterns - Array of regex pattern strings
 * @returns Array of compiled RegExp objects (only valid patterns)
 */
function compileUserPatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];

  for (const pattern of patterns.slice(0, MAX_CUSTOM_PATTERNS)) {
    // Skip empty or whitespace-only patterns
    if (!pattern || !pattern.trim()) {
      continue;
    }

    // Validate pattern length to prevent ReDoS
    if (pattern.length > MAX_PATTERN_LENGTH) {
      logger.warn('SYSTEM', 'redaction pattern too long, skipping', undefined, {
        patternLength: pattern.length,
        maxAllowed: MAX_PATTERN_LENGTH
      });
      continue;
    }

    try {
      // Compile with global flag
      compiled.push(new RegExp(pattern, 'g'));
    } catch (error) {
      // Log invalid regex but continue processing
      logger.warn('SYSTEM', 'invalid redaction pattern, skipping', undefined, {
        pattern,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return compiled;
}

/**
 * Get all redaction patterns (default + user-configured)
 * @returns Array of RegExp objects for redaction
 */
function getRedactionPatterns(): RegExp[] {
  const patterns = [...DEFAULT_REDACTION_PATTERNS];

  try {
    // Load settings from file
    const settingsPath = join(homedir(), '.claude-mem', 'settings.json');
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
    const customPatterns = settings.CLAUDE_MEM_REDACT_PATTERNS;

    if (customPatterns && typeof customPatterns === 'string' && customPatterns.trim() !== '') {
      // Split by comma and compile each pattern
      const userPatterns = customPatterns
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);

      const compiled = compileUserPatterns(userPatterns);
      patterns.push(...compiled);
    }
  } catch (error) {
    // If settings fail to load, just use default patterns
    logger.warn('SYSTEM', 'failed to load custom redaction patterns', undefined, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return patterns;
}

/**
 * Redact secrets from content using configured patterns
 * @param content - Content to redact
 * @returns Object with redacted content and count of redactions
 */
export function redactSecrets(content: string): { redacted: string; count: number } {
  if (!content || typeof content !== 'string') {
    return { redacted: content || '', count: 0 };
  }

  let redacted = content;
  let count = 0;

  // Get all patterns (default + user-configured)
  const patterns = getRedactionPatterns();

  // Apply each pattern
  for (const pattern of patterns) {
    // Clone the regex to reset lastIndex for global regexes
    const regex = new RegExp(pattern.source, pattern.flags);
    const matches = redacted.match(regex);

    if (matches) {
      count += matches.length;
      redacted = redacted.replace(regex, '[REDACTED]');
    }
  }

  // Note: We intentionally do NOT log the original content for security
  if (count > 0) {
    logger.info('SYSTEM', 'secrets redacted from content', undefined, {
      redactionCount: count,
      contentLength: content.length
    });
  }

  return { redacted, count };
}

/**
 * Internal function to strip memory tags from content
 * Shared logic extracted from both JSON and prompt stripping functions
 */
function stripTagsInternal(content: string): string {
  // ReDoS protection: limit tag count before regex processing
  const tagCount = countTags(content);
  if (tagCount > MAX_TAG_COUNT) {
    logger.warn('SYSTEM', 'tag count exceeds limit', undefined, {
      tagCount,
      maxAllowed: MAX_TAG_COUNT,
      contentLength: content.length
    });
    // Still process but log the anomaly
  }

  let result = content;

  // Strip system context tags (remove entirely)
  result = result.replace(/<claude-mem-context>[\s\S]*?<\/claude-mem-context>/g, '');

  // Strip private tags (remove entirely)
  result = result.replace(/<private>[\s\S]*?<\/private>/g, '');

  // Handle secret tags (replace content with [REDACTED])
  result = result.replace(/<secret>([\s\S]*?)<\/secret>/g, '[REDACTED]');

  // Apply automatic secret redaction
  const { redacted } = redactSecrets(result);
  result = redacted;

  return result.trim();
}

/**
 * Strip memory tags from JSON-serialized content (tool inputs/responses)
 *
 * @param content - Stringified JSON content from tool_input or tool_response
 * @returns Cleaned content with tags removed, or '{}' if invalid
 */
export function stripMemoryTagsFromJson(content: string): string {
  return stripTagsInternal(content);
}

/**
 * Strip memory tags from user prompt content
 *
 * @param content - Raw user prompt text
 * @returns Cleaned content with tags removed
 */
export function stripMemoryTagsFromPrompt(content: string): string {
  return stripTagsInternal(content);
}
