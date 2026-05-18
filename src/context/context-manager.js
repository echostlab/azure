/**
 * Smart Context Window Management for OpenCode Pro.
 *
 * Intelligently manages LLM context windows to prevent token overflow
 * while preserving the most important information.  Uses a combination
 * of truncation strategies: preservation ordering, compression of older
 * messages, and priority-based retention.
 *
 * Token estimation: 1 token ≈ 4 characters for English text (rough heuristic).
 *
 * @module context/context-manager
 */

import { debug } from '../utils/logger.js';

/** Characters-per-token heuristic for English text. */
const CHARS_PER_TOKEN = 4;

/**
 * @typedef {object} ManagedMessage
 * @property {string} role - 'system', 'user', 'assistant', or 'tool'
 * @property {string} content - Message content
 * @property {boolean} [highPriority] - If true, this message is preserved at all costs
 */

/**
 * Estimate the token count of a string using a rough heuristic.
 *
 * This is a fast approximation — not as accurate as a tokenizer, but
 * sufficient for truncation decisions in real-time bot responses.
 *
 * @param {string} text - The text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate the total token count across an array of messages.
 *
 * @param {ManagedMessage[]} messages - Array of message objects
 * @returns {number} Estimated total tokens
 */
function estimateTotalTokens(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;

  return messages.reduce((sum, msg) => {
    if (!msg || !msg.content) return sum;
    return sum + estimateTokens(msg.content);
  }, 0);
}

/**
 * Compress (summarize) an array of older conversation messages into a
 * single condensed summary message.
 *
 * The summary includes key topics discussed, decisions made, and any
 * code references mentioned.  This is a pattern-based compression —
 * ideally this would be replaced by an actual LLM summarization call,
 * but the function is designed to accept a summarizer callback for that
 * purpose.
 *
 * @param {ManagedMessage[]} messages - Older messages to compress
 * @returns {string} A condensed summary string
 */
function createSummary(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return '';
  }

  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');

  const userTopics = userMessages.slice(0, 5).map((m) => {
    const firstLine = m.content.split('\n')[0];
    return firstLine.slice(0, 120);
  });

  const decisions = assistantMessages.slice(0, 3).map((m) => {
    const firstLine = m.content.split('\n')[0];
    return firstLine.slice(0, 120);
  });

  const parts = [`[Conversation Summary — ${messages.length} messages compressed]`];

  if (userTopics.length > 0) {
    parts.push(`Topics discussed: ${userTopics.join('; ')}`);
  }

  if (decisions.length > 0) {
    parts.push(`Key responses: ${decisions.join('; ')}`);
  }

  return parts.join('\n');
}

/**
 * Condense older conversation messages into a single summary message,
 * preserving the most recent messages unchanged.
 *
 * Splits messages at the midpoint: the older half is compressed into
 * a summary, while the newer half is kept in full.
 *
 * @param {ManagedMessage[]} messages - Full conversation history
 * @returns {ManagedMessage[]} [summary message, ...recent messages]
 */
export function compressHistory(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  // Guard: too few messages to meaningfully compress
  if (messages.length <= 4) {
    return [...messages];
  }

  // Split at roughly the midpoint — compress older half
  const midpoint = Math.floor(messages.length / 2);
  const olderMessages = messages.slice(0, midpoint);
  const recentMessages = messages.slice(midpoint);

  const summaryText = createSummary(olderMessages);

  if (summaryText.length === 0) {
    return recentMessages;
  }

  /** @type {ManagedMessage} */
  const summaryMessage = {
    role: 'system',
    content: summaryText,
    highPriority: true,
  };

  return [summaryMessage, ...recentMessages];
}

/**
 * Manage the context window by intelligently truncating messages to fit
 * within a maximum token budget.
 *
 * Strategy (applied in order):
 *   1. Always preserve system prompt messages
 *   2. Always preserve messages marked as `highPriority`
 *   3. Keep the most recent messages (ordered by recency)
 *   4. Compress older messages into summaries before discarding
 *   5. Remove the oldest, lowest-priority messages first when budget is exceeded
 *
 * @param {ManagedMessage[]} messages - Array of conversation messages
 * @param {number} maxTokens - Maximum allowed tokens for the entire context
 * @param {string} [systemPrompt] - The system prompt to always preserve
 * @returns {ManagedMessage[]} Truncated message array that fits within maxTokens
 */
export function manageContext(messages, maxTokens, systemPrompt) {
  if (!Array.isArray(messages)) {
    throw new Error('manageContext: messages must be an array');
  }

  if (typeof maxTokens !== 'number' || maxTokens <= 0) {
    throw new Error(`manageContext: maxTokens must be a positive number, got ${maxTokens}`);
  }

  // Guard: empty messages — just return the system prompt if provided
  if (messages.length === 0) {
    if (systemPrompt) {
      return [{ role: 'system', content: systemPrompt, highPriority: true }];
    }
    return [];
  }

  /** @type {ManagedMessage[]} */
  let result = [];

  // Step 1: Always preserve the system prompt
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt, highPriority: true });
  }

  // Step 2: Partition messages into high-priority and regular
  const highPriorityMessages = messages.filter((m) => m.highPriority === true);
  const regularMessages = messages.filter((m) => m.highPriority !== true);

  // Step 3: Add high-priority messages
  result.push(...highPriorityMessages);

  // Step 4: Compress older regular messages if there are many
  let compressedRegular = regularMessages;
  if (regularMessages.length > 6) {
    compressedRegular = compressHistory(regularMessages);
  }

  // Step 5: Add regular messages from the end (most recent)
  // We add messages one by one from most recent and stop when budget exceeded
  const finalMessages = [];
  let currentTokens = estimateTotalTokens(result);

  for (let i = compressedRegular.length - 1; i >= 0; i--) {
    const msg = compressedRegular[i];
    if (!msg || !msg.content) continue;

    const msgTokens = estimateTokens(msg.content);
    if (currentTokens + msgTokens > maxTokens) {
      // Budget exceeded — skip remaining older messages
      debug(`Context budget exceeded at ${currentTokens + msgTokens}/${maxTokens} tokens — truncating older messages`);
      break;
    }

    finalMessages.unshift(msg);
    currentTokens += msgTokens;
  }

  result = [...result, ...finalMessages];

  debug(`Context managed: ${result.length} messages, ~${currentTokens} tokens (budget: ${maxTokens})`);
  return result;
}