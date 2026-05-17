/**
 * Issue event handlers for OpenCode Pro.
 *
 * Handles `issues.opened` (optional AI triage), `issues.assigned`
 * (auto-response), and delegates comment commands to the command router.
 *
 * @module handlers/issues
 */

import { loadConfig } from '../config.js';
import { handleCommentCommand, handleAutoAssign } from './commands.js';
import { generateStream } from '../providers/llm.js';
import { createComment } from '../utils/github.js';
import { debug } from '../utils/logger.js';

/**
 * Handle a newly opened issue.
 *
 * If `autoReview` is enabled in the repo config, posts an AI-generated
 * triage comment.
 *
 * @param {import('probot').Context<'issues.opened'>} context
 * @returns {Promise<void>}
 */
export async function handleIssueOpened(context) {
  const config = await loadConfig(context);
  if (!config.autoReview) return;

  const { issue } = context.payload;
  debug(`Issue opened: #${issue.number}`);

  // Defer to the command handler — autoReview uses the same pipeline
  // but driven by config rather than a user trigger.  We replicate the
  // auto-assign flow but for unassigned opened issues.
  try {
    const stream = await generateStream({
      prompt: `A new issue has been opened: #${issue.number} — **${issue.title}**\n\n${issue.body ?? 'No description provided.'}\n\nProvide an initial triage: classify the issue type, suggest relevant labels, and recommend next steps.`,
      system: `You are OpenCode Pro performing automated issue triage. Be structured and actionable.`,
      files: [],
      config,
    });

    let responseBody = '';
    for await (const chunk of stream) {
      responseBody += chunk;
      if (responseBody.length > 60000) {
        responseBody = responseBody.slice(0, 60000) + '\n\n... (truncated)';
        break;
      }
    }

    await createComment(context, issue.number, responseBody);
    debug(`Auto-triage posted for #${issue.number}`);
  } catch (err) {
    debug(`Auto-triage skipped or failed for #${issue.number}: ${err.message}`);
  }
}

/**
 * Handle an issue assigned event.
 *
 * @param {import('probot').Context<'issues.assigned'>} context
 * @returns {Promise<void>}
 */
export async function handleIssueAssigned(context) {
  await handleAutoAssign(context);
}

/**
 * Handle an issue comment created event.
 *
 * Delegates to the command handler to check for triggers.
 *
 * @param {import('probot').Context<'issue_comment.created'>} context
 * @returns {Promise<void>}
 */
export async function handleIssueComment(context) {
  await handleCommentCommand(context);
}