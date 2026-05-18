/**
 * Pull Request event handlers for OpenCode Pro.
 *
 * Handles `pull_request.opened` (auto-review), `pull_request.synchronize`
 * (re-review on new commits), `pull_request_review_comment.created`
 * (inline comment commands), and `pull_request.assigned` (bot-as-reviewer).
 *
 * @module handlers/pull_requests
 */

import { loadConfig } from '../config.js';
import { handleReviewCommentCommand } from './commands.js';
import { startReview, completeReview } from './checks.js';
import { mapReviewSummaryToCheckConclusion } from './review-conclusion.js';
import { generateStream } from '../providers/llm.js';
import { getPullRequestFiles } from '../utils/github.js';
import { filterIgnoredPullRequestFiles } from '../utils/ignore-patterns.js';
import { debug, error } from '../utils/logger.js';

/** @type {number} */
const MAX_DIFF_LENGTH = 50000;

/**
 * Build a reviewable diff string from PR file patches.
 *
 * @param {Array<{filename: string, patch: string}>} files
 * @returns {string}
 */
function buildPromptDiff(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return '';
  }

  return files
    .map(({ filename, patch }) => {
      const renderedPatch = patch && patch.trim().length > 0
        ? patch
        : '@@\n# File changed but patch is unavailable (binary/large file).';

      return [`diff --git a/${filename} b/${filename}`, renderedPatch].join('\n');
    })
    .join('\n\n');
}

/**
 * Run a full PR review: create a check run, stream the AI review into it,
 * and mark it complete.
 *
 * @param {import('probot').Context} context - Probot context
 * @param {import('../config.js').LoadedConfig} config - Loaded config
 * @param {object} pr - The pull request payload
 * @returns {Promise<void>}
 */
async function runReview(context, config, pr) {
  const headSha = pr.head.sha;
  if (!headSha) {
    debug('PR missing head SHA — skipping review');
    return;
  }

  const checkRunId = await startReview(context, headSha);

  try {
    const files = await getPullRequestFiles(context, pr.number);
    const reviewableFiles = filterIgnoredPullRequestFiles(files, config.ignorePatterns);

    if (reviewableFiles.length === 0) {
      await completeReview(
        context,
        checkRunId,
        'neutral',
        'No reviewable files found after applying `ignorePatterns`.',
      );
      debug(`PR review skipped for #${pr.number}: all files ignored`);
      return;
    }

    const diff = buildPromptDiff(reviewableFiles);

    const fileContext = reviewableFiles.map(({ filename, patch }) => ({
      filename,
      content: patch,
    }));

    const prompt = [
      `Review this pull request: **${pr.title}**`,
      '',
      pr.body ? `Description: ${pr.body}` : '',
      '',
      'Please provide a thorough code review covering:',
      '1. Potential bugs or logic errors',
      '2. Performance concerns',
      '3. Security issues',
      '4. Code style and best practice violations',
      '5. Suggestions for improvement',
      '',
      'Diff:',
      '```diff',
      diff.slice(0, MAX_DIFF_LENGTH),
      '```',
    ].join('\n');

    const systemPrompt = [
      'You are OpenCode Pro performing an automated code review. Be thorough, constructive, and specific. Reference file paths and line numbers when possible. Format your response in markdown.',
      '',
      'End your review with exactly one of these tokens on its own line:',
      'CONCLUSION: APPROVE',
      'CONCLUSION: REJECT',
      'CONCLUSION: COMMENT',
    ].join('\n');

    const stream = await generateStream({
      prompt,
      system: systemPrompt,
      files: fileContext,
      config,
    });

    let summary = '';
    for await (const chunk of stream) {
      summary += chunk;
    }

    const conclusion = mapReviewSummaryToCheckConclusion(summary);

    await completeReview(context, checkRunId, conclusion, summary);
    debug(`PR review completed for #${pr.number}: ${conclusion}`);
  } catch (err) {
    error(`PR review failed for #${pr.number}`, err);
    await completeReview(
      context,
      checkRunId,
      'failure',
      'Review failed due to an internal error. Please try again later.',
    );
  }
}

/**
 * Handle a newly opened pull request.
 *
 * Runs an AI-powered code review if `autoReview` is enabled in config.
 *
 * @param {import('probot').Context<'pull_request.opened'>} context
 * @returns {Promise<void>}
 */
export async function handlePullRequestOpened(context) {
  const config = await loadConfig(context);
  if (!config.autoReview) return;

  const pr = context.payload.pull_request;
  debug(`PR opened: #${pr.number} — ${pr.title}`);
  await runReview(context, config, pr);
}

/**
 * Handle new commits pushed to an existing PR (synchronize event).
 *
 * @param {import('probot').Context<'pull_request.synchronize'>} context
 * @returns {Promise<void>}
 */
export async function handlePullRequestSynchronize(context) {
  const config = await loadConfig(context);
  if (!config.autoReview) return;

  const pr = context.payload.pull_request;
  debug(`PR synchronize: #${pr.number}`);
  await runReview(context, config, pr);
}

/**
 * Handle inline PR review comments.
 *
 * Delegates to the command handler to check for `/oc` or `@opencode-pro`
 * triggers within the review comment.
 *
 * @param {import('probot').Context<'pull_request_review_comment.created'>} context
 * @returns {Promise<void>}
 */
export async function handleReviewComment(context) {
  await handleReviewCommentCommand(context);
}

/**
 * Handle PR assigned event — auto-review when bot is added as reviewer.
 *
 * @param {import('probot').Context<'pull_request.assigned'>} context
 * @returns {Promise<void>}
 */
export async function handlePullRequestAssigned(context) {
  const config = await loadConfig(context);
  if (!config.autoAssign) return;

  const pr = context.payload.pull_request;
  const assignee = context.payload.assignee;
  if (!assignee) return;

  try {
    const { data } = await context.octokit.apps.getAuthenticated();
    const botUsername = data.slug ? `${data.slug}[bot]` : null;
    if (!botUsername || assignee.login.toLowerCase() !== botUsername.toLowerCase()) return;
  } catch {
    return;
  }

  debug(`Bot assigned as reviewer for PR #${pr.number}`);
  await runReview(context, config, pr);
}
