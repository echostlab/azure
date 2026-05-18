/**
 * Trigger detector — determines whether a comment or event should activate
 * the OpenCode Pro bot.
 *
 * Recognises:
 *   - `/oc` and `/opencode` slash commands
 *   - `@opencode-pro` and `@opencode-pro[bot]` mentions
 *   - Auto-triggers from assignment events
 *
 * @module handlers/trigger
 */

import { parseCommandOverrides } from './command-overrides.js';

/**
 * @typedef {object} TriggerResult
 * @property {boolean} triggered - Whether the bot should respond
 * @property {'slash' | 'mention' | 'auto' | null} type - How it was triggered
 * @property {{ model?: string, provider?: string, agent?: string, continue?: boolean }} params - Extracted parameters
 */

/**
 * Patterns for slash-command detection.
 *
 * @type {RegExp[]}
 */
const SLASH_PATTERNS = [
  /\b\/oc\b/i,
  /\b\/opencode\b/i,
];

/**
 * Patterns for @mention detection.
 *
 * @type {RegExp[]}
 */
const MENTION_PATTERNS = [
  /\B@opencode-pro\b/i,
  /\B@opencode-pro\[bot\]\b/i,
];

/**
 * Detect if a comment body should trigger the bot.
 *
 * @param {string} commentBody - Raw comment text
 * @param {string} commentAuthor - GitHub username of the commenter
 * @param {string} botUsername - The bot's GitHub username
 * @returns {TriggerResult}
 */
export function detectTrigger(commentBody, commentAuthor, botUsername) {
  // Guard: never respond to the bot's own comments
  if (commentAuthor === botUsername) {
    return { triggered: false, type: null, params: {} };
  }

  // Guard: empty body — nothing to detect
  if (typeof commentBody !== 'string' || commentBody.trim().length === 0) {
    return { triggered: false, type: null, params: {} };
  }

  // Check slash commands first — they are intentional and explicit
  for (const pattern of SLASH_PATTERNS) {
    if (pattern.test(commentBody)) {
      return {
        triggered: true,
        type: 'slash',
        params: parseCommandOverrides(commentBody),
      };
    }
  }

  // Check @mentions second
  for (const pattern of MENTION_PATTERNS) {
    if (pattern.test(commentBody)) {
      return {
        triggered: true,
        type: 'mention',
        params: parseCommandOverrides(commentBody),
      };
    }
  }

  return { triggered: false, type: null, params: {} };
}

/**
 * Detect if an assignment event should automatically trigger the bot.
 *
 * Returns an auto-trigger when the assigned user matches the bot's username.
 *
 * @param {string} assigneeLogin - GitHub username of the assignee
 * @param {string} botUsername - The bot's GitHub username
 * @returns {TriggerResult}
 */
export function detectAutoTrigger(assigneeLogin, botUsername) {
  if (typeof assigneeLogin !== 'string' || assigneeLogin.length === 0) {
    return { triggered: false, type: null, params: {} };
  }

  const isBotAssignee = assigneeLogin.toLowerCase() === botUsername.toLowerCase();

  return {
    triggered: isBotAssignee,
    type: 'auto',
    params: {},
  };
}
