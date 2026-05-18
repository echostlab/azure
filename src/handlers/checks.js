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
import { debug, error, warn } from '../utils/logger.js';
import { normalizeCheckConclusion } from './review-conclusion.js';

/**
 * @typedef {import('../utils/github.js').createCheckRun} CreateCheckRunResult
 */

/**
 * Start a new check run for an AI review and return its ID.
 *
 * @param {import('probot').Context} context - Probot context
 * @param {string} headSha - Commit SHA being reviewed
 * @param {string | null} [externalId] - Idempotency key for this review run
 * @returns {Promise<number>} The check run ID
 */
export async function startReview(context, headSha, externalId = null) {
  const check = await createCheckRun(context, {
    headSha,
    name: 'OpenCode Pro Review',
    status: 'in_progress',
    externalId,
  });

  debug(`Check run started: ${check.id}`);
  return check.id;
}

/**
 * Mark a check run as completed with a conclusion and summary.
 *
 * @param {import('probot').Context} context - Probot context
 * @param {number} checkRunId - The check run to complete
 * @param {string} conclusion - Final status
 * @param {string} summary - Markdown summary text
 * @returns {Promise<void>}
 */
export async function completeReview(context, checkRunId, conclusion, summary) {
  if (!checkRunId) {
    throw new Error('completeReview: checkRunId is required');
  }

  const normalizedConclusion = normalizeCheckConclusion(conclusion);
  if (normalizedConclusion !== conclusion) {
    warn(
      `Invalid check conclusion "${String(conclusion)}"; falling back to "${normalizedConclusion}"`,
    );
  }

  try {
    await updateCheckRun(context, checkRunId, {
      status: 'completed',
      conclusion: normalizedConclusion,
      output: {
        title: 'OpenCode Pro Review',
        summary,
      },
    });
  } catch (err) {
    error(`Failed to update check run ${checkRunId}`, err);
    throw new Error(`completeReview: unable to complete check run ${checkRunId}`, {
      cause: err,
    });
  }

  debug(`Check run ${checkRunId} completed: ${normalizedConclusion}`);
}
