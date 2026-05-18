/**
 * Command parser and router.
 *
 * Inspects comment bodies for trigger patterns (`/oc`, `@opencode-pro`, etc.)
 * and routes them to the appropriate handler with extracted parameters.
 *
 * @module handlers/commands
 */

import { detectTrigger, detectAutoTrigger } from './trigger.js';
import { generateStream } from '../providers/llm.js';
import { createComment, getPullRequestFiles } from '../utils/github.js';
import { loadConfig } from '../config.js';
import {
  applyCommandOverrides,
  CommandOverrideError,
  stripCommandOverrides,
} from './command-overrides.js';
import { isCommandExecutionAuthorized } from './command-authorization.js';
import { getRepoContext } from '../context/repo-context.js';
import { manageContext } from '../context/context-manager.js';
import { debug, error } from '../utils/logger.js';

/** @type {string} */
const MAX_RESPONSE_LENGTH = 60000;

/**
 * Post a command-override failure message for a single execution.
 *
 * @param {import('probot').Context} context
 * @param {number} issueNumber
 * @param {string} sessionRef
 * @param {Error} err
 * @returns {Promise<void>}
 */
async function handleOverrideFailure(context, issueNumber, sessionRef, err) {
  if (!(err instanceof CommandOverrideError)) {
    throw err;
  }

  error('Command override rejected for this execution', err);
  await createComment(
    context,
    issueNumber,
    `❌ I couldn't apply those command overrides for this request. Please verify the command parameters and repository configuration.${sessionRef}`,
  );
}

/**
 * Build a concise authorization failure response.
 *
 * @param {string} sessionRef
 * @returns {string}
 */
function buildUnauthorizedMessage(sessionRef) {
  return `🔒 Slash commands and @mentions are limited to repository owners, members, and collaborators.${sessionRef}`;
}

/**
 * Handle an incoming comment — check for triggers, and if found, generate
 * and post an AI response.
 *
 * @param {import('probot').Context<'issue_comment.created'>} context
 * @returns {Promise<void>}
 */
export async function handleCommentCommand(context) {
  const { comment, repository, issue } = context.payload;
  const commentBody = comment.body;
  const commentAuthor = comment.user.login;
  const issueNumber = issue.number;

  // Resolve the bot's username from the installation
  const botUsername = await resolveBotUsername(context);
  if (!botUsername) return;

  const trigger = detectTrigger(commentBody, commentAuthor, botUsername);
  if (!trigger.triggered) return;

  debug(`Trigger detected: type=${trigger.type}, author=${commentAuthor}`);

  // Build session reference for debugging
  const owner = repository?.owner?.login ?? 'unknown';
  const repo = repository?.name ?? 'unknown';
  const runId = context.id ?? 'local';
  const sessionRef = `\n\n---\n📊 Session reference: \`${owner}/${repo}#${issueNumber}—${runId}\``;

  if (!isCommandExecutionAuthorized(trigger.type, comment.author_association)) {
    await createComment(context, issueNumber, buildUnauthorizedMessage(sessionRef));
    return;
  }

  const config = await loadConfig(context);

  let effectiveConfig;
  let selectedAgent;
  let continueConversation;

  try {
    const applied = applyCommandOverrides(config, trigger.params);
    effectiveConfig = applied.config;
    selectedAgent = applied.selectedAgent;
    continueConversation = applied.continueConversation;
  } catch (err) {
    await handleOverrideFailure(context, issueNumber, sessionRef, /** @type {Error} */ (err));
    return;
  }

  // Build enriched prompt with repository context awareness
  const basePrompt = buildPrompt(commentBody, trigger);
  const repoCtx = continueConversation ? await getRepoContext(context, issueNumber) : null;
  const enrichedPrompt = repoCtx
    ? `${basePrompt}\n\nRepository Context:\n${repoCtx.contextBlock}`
    : basePrompt;

  // Manage context window — trim if prompt exceeds token budget
  const maxTokens = effectiveConfig.maxContextTokens || 128000;
  const managedMessages = manageContext(
    [
      {
        role: 'system',
        content: buildSystemPrompt(effectiveConfig, selectedAgent),
        highPriority: true,
      },
      { role: 'user', content: enrichedPrompt },
    ],
    maxTokens,
  );

  // Extract the managed user prompt (last message with role='user')
  const finalPrompt = managedMessages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n') || enrichedPrompt;

  try {
    const stream = await generateStream({
      prompt: finalPrompt,
      system: buildSystemPrompt(effectiveConfig, selectedAgent),
      files: [],
      config: effectiveConfig,
    });

    let responseBody = '';
    for await (const chunk of stream) {
      responseBody += chunk;
      if (responseBody.length > MAX_RESPONSE_LENGTH) {
        responseBody = responseBody.slice(0, MAX_RESPONSE_LENGTH) + '\n\n... (truncated)';
        break;
      }
    }

    // Append the session reference footer
    await createComment(context, issueNumber, responseBody + sessionRef);
    debug(`Response posted to #${issueNumber} (${responseBody.length} chars)`);
  } catch (err) {
    error('Failed to generate or post response', err);
    await createComment(context, issueNumber, `❌ Sorry, I encountered an error processing your request. Please try again.${sessionRef}`);
  }
}

/**
 * Handle assignment events — auto-respond when the bot is assigned.
 *
 * @param {import('probot').Context<'issues.assigned'>} context
 * @returns {Promise<void>}
 */
export async function handleAutoAssign(context) {
  const assignee = context.payload.assignee;
  if (!assignee) return;

  const botUsername = await resolveBotUsername(context);
  if (!botUsername) return;

  const trigger = detectAutoTrigger(assignee.login, botUsername);
  if (!trigger.triggered) return;

  const config = await loadConfig(context);
  if (!config.autoAssign) return;

  const issue = context.payload.issue;

  debug(`Auto-trigger from assignment: #${issue.number}`);

  const owner = context.payload.repository?.owner?.login ?? 'unknown';
  const repo = context.payload.repository?.name ?? 'unknown';
  const runId = context.id ?? 'local';
  const sessionRef = `\n\n---\n📊 Session reference: \`${owner}/${repo}#${issue.number}—${runId}\``;

  try {
    const stream = await generateStream({
      prompt: `You have been assigned to issue #${issue.number}: **${issue.title}**\n\n${issue.body ?? 'No description provided.'}\n\nPlease provide a helpful analysis and suggest next steps.`,
      system: buildSystemPrompt(config),
      files: [],
      config,
    });

    let responseBody = '';
    for await (const chunk of stream) {
      responseBody += chunk;
      if (responseBody.length > MAX_RESPONSE_LENGTH) {
        responseBody = responseBody.slice(0, MAX_RESPONSE_LENGTH) + '\n\n... (truncated)';
        break;
      }
    }

    await createComment(context, issue.number, responseBody + sessionRef);
    debug(`Auto-response posted to #${issue.number}`);
  } catch (err) {
    error('Auto-assign response failed', err);
    await createComment(context, issue.number, `❌ Sorry, I encountered an error processing your request. Please try again.${sessionRef}`);
  }
}

/**
 * Handle auto PR review via command trigger in a PR review comment.
 *
 * @param {import('probot').Context<'pull_request_review_comment.created'>} context
 * @returns {Promise<void>}
 */
export async function handleReviewCommentCommand(context) {
  const { comment, pull_request: pullRequest } = context.payload;
  const commentBody = comment.body;
  const commentAuthor = comment.user.login;

  const botUsername = await resolveBotUsername(context);
  if (!botUsername) return;

  const trigger = detectTrigger(commentBody, commentAuthor, botUsername);
  if (!trigger.triggered) return;

  debug(`Review comment trigger: type=${trigger.type}`);

  const owner = context.payload.repository?.owner?.login ?? 'unknown';
  const repo = context.payload.repository?.name ?? 'unknown';
  const runId = context.id ?? 'local';
  const sessionRef = `\n\n---\n📊 Session reference: \`${owner}/${repo}#${pullRequest.number}—${runId}\``;

  if (!isCommandExecutionAuthorized(trigger.type, comment.author_association)) {
    await createComment(context, pullRequest.number, buildUnauthorizedMessage(sessionRef));
    return;
  }

  const config = await loadConfig(context);

  let effectiveConfig;
  let selectedAgent;

  try {
    const applied = applyCommandOverrides(config, trigger.params);
    effectiveConfig = applied.config;
    selectedAgent = applied.selectedAgent;
  } catch (err) {
    await handleOverrideFailure(
      context,
      pullRequest.number,
      sessionRef,
      /** @type {Error} */ (err),
    );
    return;
  }

  // Fetch the PR files for context
  const files = await getPullRequestFiles(context, pullRequest.number);

  const prompt = `Review comment on PR #${pullRequest.number}:\n\nComment: ${commentBody}\n\nProvide a detailed response addressing this specific review comment.`;

  try {
    const stream = await generateStream({
      prompt,
      system: buildSystemPrompt(effectiveConfig, selectedAgent),
      files,
      config: effectiveConfig,
    });

    let responseBody = '';
    for await (const chunk of stream) {
      responseBody += chunk;
      if (responseBody.length > MAX_RESPONSE_LENGTH) {
        responseBody = responseBody.slice(0, MAX_RESPONSE_LENGTH) + '\n\n... (truncated)';
        break;
      }
    }

    await createComment(context, pullRequest.number, responseBody + sessionRef);
    debug(`Review response posted to PR #${pullRequest.number}`);
  } catch (err) {
    error('Review comment response failed', err);
    await createComment(context, pullRequest.number, `❌ Sorry, I encountered an error processing your request. Please try again.${sessionRef}`);
  }
}

/**
 * Resolve the bot's GitHub username from the installation.
 *
 * @param {import('probot').Context} context
 * @returns {Promise<string | null>}
 */
async function resolveBotUsername(context) {
  try {
    const { data } = await context.octokit.apps.getAuthenticated();
    return data.slug ? `${data.slug}[bot]` : null;
  } catch {
    return null;
  }
}

/**
 * Build a clean prompt by stripping the trigger token from the comment body.
 *
 * @param {string} body - Raw comment body
 * @param {import('./trigger.js').TriggerResult} trigger
 * @returns {string}
 */
function buildPrompt(body, trigger) {
  let cleaned = body;

  if (trigger.type === 'slash') {
    cleaned = cleaned.replace(/\/oc\b/gi, '').replace(/\/opencode\b/gi, '');
  }
  if (trigger.type === 'mention') {
    cleaned = cleaned.replace(/\B@opencode-pro(?:\[bot\])?\b/gi, '');
  }

  // Also strip override tokens so they don't pollute the prompt
  cleaned = stripCommandOverrides(cleaned);

  return cleaned.trim() || 'Please help with this issue.';
}

/**
 * Build a default system prompt for the LLM.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @param {{ name: string, systemPrompt?: string } | null} [selectedAgent]
 * @returns {string}
 */
function buildSystemPrompt(config, selectedAgent = null) {
  const basePrompt = `You are OpenCode Pro, an AI coding assistant bot running as a GitHub App. You help developers by reviewing code, answering questions, and providing actionable suggestions.

Guidelines:
- Be concise but thorough.
- Use markdown formatting for code blocks, lists, and emphasis.
- When suggesting code changes, include diff-style before/after blocks.
- Reference specific files and line numbers when possible.
- If you're unsure about something, say so rather than guessing.

You are running with model: ${config.model}.`;

  if (!selectedAgent?.systemPrompt) {
    return basePrompt;
  }

  return [
    `Active agent: ${selectedAgent.name}`,
    '',
    selectedAgent.systemPrompt,
    '',
    basePrompt,
  ].join('\n');
}
