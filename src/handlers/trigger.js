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

/** @type {RegExp} */
const SLASH_COMMAND_PATTERN = /(^|\s)\/(?:oc|opencode)\b/;

/**
 * Normalize user-provided identifiers for robust trigger comparison.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeComparable(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.normalize('NFKC').trim().toLowerCase();
}

/**
 * Escape regex metacharacters from an arbitrary username fragment.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build mention candidates from a bot username.
 *
 * For `opencode-pro[bot]`, this returns:
 * - `opencode-pro[bot]`
 * - `opencode-pro`
 *
 * @param {string} botUsername
 * @returns {string[]}
 */
function buildMentionCandidates(botUsername) {
  const normalized = normalizeComparable(botUsername).replace(/^@/, '');
  if (!normalized) {
    return [];
  }

  const candidates = new Set([normalized]);

  if (normalized.endsWith('[bot]')) {
    const withoutSuffix = normalized.slice(0, -'[bot]'.length);
    if (withoutSuffix) {
      candidates.add(withoutSuffix);
    }
  } else {
    candidates.add(`${normalized}[bot]`);
  }

  return [...candidates];
}

/**
 * Determine whether a comment contains a valid slash command trigger.
 *
 * @param {string} commentBody
 * @returns {boolean}
 */
function hasSlashCommandTrigger(commentBody) {
  return SLASH_COMMAND_PATTERN.test(commentBody);
}

/**
 * Determine whether a comment contains a mention trigger for this bot.
 *
 * @param {string} commentBody
 * @param {string} botUsername
 * @returns {boolean}
 */
function hasMentionTrigger(commentBody, botUsername) {
  const mentionCandidates = buildMentionCandidates(botUsername);
  if (mentionCandidates.length === 0) {
    return false;
  }

  const normalizedCommentBody = normalizeComparable(commentBody);
  if (!normalizedCommentBody) {
    return false;
  }

  return mentionCandidates.some((candidate) => {
    const mentionPattern = new RegExp(`(^|\\s)@${escapeRegex(candidate)}(?=\\s|$|[.,!?;:])`);
    return mentionPattern.test(normalizedCommentBody);
  });
}

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
  const normalizedAuthor = normalizeComparable(commentAuthor);
  const normalizedBotUsername = normalizeComparable(botUsername);

  if (normalizedAuthor && normalizedBotUsername && normalizedAuthor === normalizedBotUsername) {
    return { triggered: false, type: null, params: {} };
  }

  // Guard: empty body — nothing to detect
  const normalizedBody = normalizeComparable(commentBody);
  if (!normalizedBody) {
    return { triggered: false, type: null, params: {} };
  }

  // Check slash commands first — they are intentional and explicit
  if (hasSlashCommandTrigger(normalizedBody)) {
    return {
      triggered: true,
      type: 'slash',
      params: parseCommandOverrides(commentBody),
    };
  }

  // Check @mentions second
  if (hasMentionTrigger(commentBody, botUsername)) {
    return {
      triggered: true,
      type: 'mention',
      params: parseCommandOverrides(commentBody),
    };
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
  const normalizedAssignee = normalizeComparable(assigneeLogin);
  if (!normalizedAssignee) {
    return { triggered: false, type: null, params: {} };
  }

  const normalizedBotUsername = normalizeComparable(botUsername);
  if (!normalizedBotUsername) {
    return { triggered: false, type: null, params: {} };
  }

  const isBotAssignee = normalizedAssignee === normalizedBotUsername;

  return {
    triggered: isBotAssignee,
    type: isBotAssignee ? 'auto' : null,
    params: {},
  };
}
