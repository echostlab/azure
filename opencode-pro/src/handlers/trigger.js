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

/**
 * @typedef {object} TriggerResult
 * @property {boolean} triggered - Whether the bot should respond
 * @property {'slash' | 'mention' | 'auto' | null} type - How it was triggered
 * @property {{ model?: string, provider?: string, agent?: string }} params - Extracted parameters
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
 * Maximum allowed length for an extracted parameter value.
 *
 * @type {number}
 */
const MAX_PARAM_LENGTH = 256;

/**
 * Extract CLI-style key=value parameters from a comment body.
 *
 * Parameters are single words of the form `key=value` appearing after
 * the trigger word.  Supports quoted and unquoted values.
 * Values exceeding {@link MAX_PARAM_LENGTH} characters are silently ignored.
 *
 * @param {string} body - Full comment body
 * @returns {{ model?: string, provider?: string, agent?: string }}
 */
function extractParams(body) {
  if (!body) return {};

  /** @type {Record<string, string>} */
  const params = {};
  const paramRegex = /\b(model|provider|agent)=("[^"]*"|'[^']*'|\S+)/gi;

  for (const match of body.matchAll(paramRegex)) {
    const key = match[1].toLowerCase();
    let value = match[2];

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (value.length > MAX_PARAM_LENGTH) continue;

    params[key] = value;
  }

  return {
    model: params.model,
    provider: params.provider,
    agent: params.agent,
  };
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
        params: extractParams(commentBody),
      };
    }
  }

  // Check @mentions second
  for (const pattern of MENTION_PATTERNS) {
    if (pattern.test(commentBody)) {
      return {
        triggered: true,
        type: 'mention',
        params: extractParams(commentBody),
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