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
const SLASH_COMMAND_PATTERN = /(^|\s)\/(?:oc|opencode)\b/i;

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
  if (typeof botUsername !== 'string' || botUsername.trim().length === 0) {
    return [];
  }

  const normalized = botUsername.trim().replace(/^@/, '').toLowerCase();
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

  return mentionCandidates.some((candidate) => {
    const mentionPattern = new RegExp(`(^|\\s)@${escapeRegex(candidate)}(?=\\s|$|[.,!?;:])`, 'i');
    return mentionPattern.test(commentBody);
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
  const normalizedAuthor = typeof commentAuthor === 'string' ? commentAuthor.toLowerCase() : '';
  const normalizedBotUsername = typeof botUsername === 'string' ? botUsername.toLowerCase() : '';

  if (normalizedAuthor && normalizedBotUsername && normalizedAuthor === normalizedBotUsername) {
    return { triggered: false, type: null, params: {} };
  }

  // Guard: empty body — nothing to detect
  if (typeof commentBody !== 'string' || commentBody.trim().length === 0) {
    return { triggered: false, type: null, params: {} };
  }

  // Check slash commands first — they are intentional and explicit
  if (hasSlashCommandTrigger(commentBody)) {
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
  if (typeof assigneeLogin !== 'string' || assigneeLogin.length === 0) {
    return { triggered: false, type: null, params: {} };
  }

  if (typeof botUsername !== 'string' || botUsername.length === 0) {
    return { triggered: false, type: null, params: {} };
  }

  const isBotAssignee = assigneeLogin.toLowerCase() === botUsername.toLowerCase();

  return {
    triggered: isBotAssignee,
    type: 'auto',
    params: {},
  };
}
