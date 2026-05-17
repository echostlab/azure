/**
 * Check-run helpers for OpenCode Pro.
 *
 * Creates and manages GitHub Check Runs for AI-powered PR reviews.
 * Each review is represented as a check run that transitions from
 * `queued` → `in_progress` → `completed`.
 *
 * @module handlers/checks
 */

import { createCheckRun, updateCheckRun } from '../utils/github.js';
import { debug, error } from '../utils/logger.js';

/**
 * @typedef {import('../utils/github.js').createCheckRun} CreateCheckRunResult
 */

/**
 * Start a new check run for an AI review and return its ID.
 *
 * @param {import('probot').Context} context - Probot context
 * @param {string} headSha - Commit SHA being reviewed
 * @returns {Promise<number>} The check run ID
 */
export async function startReview(context, headSha) {
  const check = await createCheckRun(context, {
    headSha,
    name: 'OpenCode Pro Review',
    status: 'in_progress',
  });

  debug(`Check run started: ${check.id}`);
  return check.id;
}

/**
 * Mark a check run as completed with a conclusion and summary.
 *
 * @param {import('probot').Context} context - Probot context
 * @param {number} checkRunId - The check run to complete
 * @param {'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required'} conclusion - Final status
 * @param {string} summary - Markdown summary text
 * @returns {Promise<void>}
 */
export async function completeReview(context, checkRunId, conclusion, summary) {
  if (!checkRunId) {
    error('completeReview called without checkRunId');
    return;
  }

  await updateCheckRun(context, checkRunId, {
    status: 'completed',
    conclusion,
    output: {
      title: 'OpenCode Pro Review',
      summary,
    },
  });

  debug(`Check run ${checkRunId} completed: ${conclusion}`);
}