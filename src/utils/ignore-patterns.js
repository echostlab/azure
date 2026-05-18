/**
 * Ignore pattern helpers for PR review filtering.
 *
 * Supports glob-like patterns used in config `ignorePatterns` and applies
 * them to PR filenames before review prompts are built.
 *
 * @module utils/ignore-patterns
 */

import { debug } from './logger.js';

/**
 * Escape regex metacharacters in a literal string segment.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/**
 * Convert a glob-like ignore pattern into a regular expression.
 *
 * Supported tokens:
 * - `*`  => any chars except `/`
 * - `**` => any chars including `/`
 * - `?`  => any single char except `/`
 *
 * Patterns without `/` are matched against basename as well.
 *
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compilePattern(pattern) {
  if (typeof pattern !== 'string') return null;

  let normalized = pattern.trim().replace(/\\/g, '/');
  if (!normalized) return null;

  if (normalized.startsWith('./')) {
    normalized = normalized.slice(2);
  }

  if (normalized.endsWith('/')) {
    normalized = `${normalized}**`;
  }

  const escaped = escapeRegex(normalized);
  const regexBody = escaped
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/::DOUBLE_STAR::/g, '.*');

  const shouldMatchBasename = !normalized.includes('/');
  const anchored = shouldMatchBasename
    ? `(?:^|.*/)${regexBody}$`
    : `^${regexBody}$`;

  return new RegExp(anchored);
}

/**
 * Determine whether a file path should be ignored.
 *
 * @param {string} filename
 * @param {string[]} ignorePatterns
 * @returns {boolean}
 */
export function shouldIgnoreFile(filename, ignorePatterns = []) {
  if (typeof filename !== 'string' || filename.length === 0) {
    return false;
  }

  if (!Array.isArray(ignorePatterns) || ignorePatterns.length === 0) {
    return false;
  }

  const normalizedPath = filename.replace(/\\/g, '/');

  for (const pattern of ignorePatterns) {
    const compiled = compilePattern(pattern);
    if (!compiled) continue;

    if (compiled.test(normalizedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter PR files by configured ignore patterns.
 *
 * @param {Array<{filename: string, patch: string}>} files
 * @param {string[]} ignorePatterns
 * @returns {Array<{filename: string, patch: string}>}
 */
export function filterIgnoredPullRequestFiles(files, ignorePatterns = []) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  const reviewable = files.filter((file) => !shouldIgnoreFile(file.filename, ignorePatterns));
  const ignoredCount = files.length - reviewable.length;

  if (ignoredCount > 0) {
    debug(`Ignored ${ignoredCount} PR file(s) based on ignorePatterns`);
  }

  return reviewable;
}
