/**
 * Structured logging utility.
 *
 * Wraps console methods with timestamp and log-level tagging.
 * Respects the LOG_LEVEL environment variable.
 *
 * @module utils/logger
 */

/** @type {Record<string, number>} */
const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** @type {string} */
const currentLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = LEVELS[currentLevel] ?? LEVELS.info;

/**
 * Format a log entry with an ISO timestamp and level prefix.
 *
 * @param {string} level
 * @param {string} message
 * @param {unknown} [data]
 * @returns {[string, ...unknown[]]}
 */
function format(level, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (data !== undefined) {
    return [`${prefix} ${message}`, data];
  }
  return [`${prefix} ${message}`];
}

/**
 * Log a debug-level message (only when LOG_LEVEL=debug).
 *
 * @param {string} message
 * @param {unknown} [data]
 */
export function debug(message, data) {
  if (threshold > LEVELS.debug) return;
  console.debug(...format('debug', message, data));
}

/**
 * Log an info-level message.
 *
 * @param {string} message
 * @param {unknown} [data]
 */
export function info(message, data) {
  if (threshold > LEVELS.info) return;
  console.info(...format('info', message, data));
}

/**
 * Log a warning-level message.
 *
 * @param {string} message
 * @param {unknown} [data]
 */
export function warn(message, data) {
  if (threshold > LEVELS.warn) return;
  console.warn(...format('warn', message, data));
}

/**
 * Log an error-level message.
 *
 * @param {string} message
 * @param {unknown} [data]
 */
export function error(message, data) {
  if (threshold > LEVELS.error) return;
  console.error(...format('error', message, data));
}