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
import { debug, error, warn } from '../utils/logger.js';

/**
 * Parse a positive integer from env input.
 *
 * @param {string | undefined} rawValue
 * @param {number} fallback
 * @returns {number}
 */
function parsePositiveInteger(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** @type {number} */
const MAX_DIFF_LENGTH = 50000;

/** @type {string} */
const REVIEW_CHECK_NAME = 'OpenCode Pro Review';

/** @type {Set<string>} */
const activeReviewLocks = new Set();

/** @type {Set<string>} */
const seenReviewHeadKeys = new Set();

/** @type {number} */
const CHECKS_LIST_RETRY_ATTEMPTS = 3;

/** @type {number} */
const CHECKS_LIST_RETRY_DELAY_MS = 300;

/** @type {number} */
const SEEN_REVIEW_KEYS_MAX = parsePositiveInteger(
  process.env.OPENCODE_PRO_SEEN_REVIEW_KEYS_MAX,
  2000,
);

/** @type {number} */
const SEEN_REVIEW_KEYS_TTL_MS = parsePositiveInteger(
  process.env.OPENCODE_PRO_SEEN_REVIEW_KEYS_TTL_MS,
  6 * 60 * 60 * 1000,
);

/** @type {boolean} */
const ALLOW_DUPLICATE_CHECK_FAIL_OPEN = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN ?? '').trim().toLowerCase(),
);

/**
 * Sleep helper for brief retry backoff.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

/**
 * Remove expired or excess in-memory dedupe keys.
 *
 * @returns {void}
 */
function pruneSeenReviewHeadKeys() {
  const now = Date.now();
  const entries = [...seenReviewHeadKeys];

  for (const entry of entries) {
    const [key, seenAt] = entry.split('|');
    if (!key || !seenAt) {
      seenReviewHeadKeys.delete(entry);
      continue;
    }

    const seenTimestamp = Number.parseInt(seenAt, 10);
    if (!Number.isFinite(seenTimestamp) || now - seenTimestamp > SEEN_REVIEW_KEYS_TTL_MS) {
      seenReviewHeadKeys.delete(entry);
    }
  }

  while (seenReviewHeadKeys.size > SEEN_REVIEW_KEYS_MAX) {
    const oldestEntry = seenReviewHeadKeys.values().next().value;
    if (!oldestEntry) {
      break;
    }
    seenReviewHeadKeys.delete(oldestEntry);
  }
}

/**
 * Check whether an idempotency key has been seen in this process.
 *
 * @param {string} reviewIdempotencyKey
 * @returns {boolean}
 */
function hasSeenReviewHeadKey(reviewIdempotencyKey) {
  pruneSeenReviewHeadKeys();
  for (const entry of seenReviewHeadKeys) {
    if (entry.startsWith(`${reviewIdempotencyKey}|`)) {
      return true;
    }
  }

  return false;
}

/**
 * Track an idempotency key as seen in this process.
 *
 * @param {string} reviewIdempotencyKey
 * @returns {void}
 */
function markSeenReviewHeadKey(reviewIdempotencyKey) {
  for (const entry of seenReviewHeadKeys) {
    if (entry.startsWith(`${reviewIdempotencyKey}|`)) {
      seenReviewHeadKeys.delete(entry);
    }
  }

  seenReviewHeadKeys.add(`${reviewIdempotencyKey}|${Date.now()}`);
  pruneSeenReviewHeadKeys();
}

/**
 * Build an idempotency lock key for one PR/head SHA review run.
 *
 * @param {import('probot').Context} context
 * @param {object} pr
 * @param {string} headSha
 * @returns {string}
 */
function buildReviewLockKey(context, pr, headSha) {
  const owner = context.payload.repository?.owner?.login ?? 'unknown-owner';
  const repo = context.payload.repository?.name ?? 'unknown-repo';
  return `${owner}/${repo}#${pr.number}:${headSha}`;
}

/**
 * Best-effort list of check-runs for a ref with bounded retries.
 *
 * @param {import('probot').Context} context
 * @param {string} headSha
 * @returns {Promise<Array<{id?: number, name?: string, status?: string, conclusion?: string | null, external_id?: string | null, pull_requests?: Array<{number?: number}>}> | null>}
 */
async function listReviewCheckRunsWithRetry(context, headSha) {
  for (let attempt = 1; attempt <= CHECKS_LIST_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const { data } = await context.octokit.checks.listForRef({
        ...context.repo(),
        ref: headSha,
        check_name: REVIEW_CHECK_NAME,
        per_page: 100,
      });

      return Array.isArray(data?.check_runs) ? data.check_runs : [];
    } catch (err) {
      warn(
        `Failed to inspect existing check-runs for ${headSha} (attempt ${attempt}/${CHECKS_LIST_RETRY_ATTEMPTS})`,
        err,
      );

      if (attempt < CHECKS_LIST_RETRY_ATTEMPTS) {
        await sleep(CHECKS_LIST_RETRY_DELAY_MS);
      }
    }
  }

  return null;
}

/**
 * Determine whether a check-run is associated to a PR number.
 *
 * @param {{ pull_requests?: Array<{number?: number}> }} checkRun
 * @param {number} pullRequestNumber
 * @returns {boolean}
 */
function checkRunMatchesPullRequest(checkRun, pullRequestNumber) {
  const linkedPullRequests = Array.isArray(checkRun.pull_requests)
    ? checkRun.pull_requests
    : [];

  if (linkedPullRequests.length === 0) {
    // GitHub may omit PR linkage in some responses. For same-SHA dedupe,
    // treat same-name checks as duplicates when linkage is absent.
    return true;
  }

  return linkedPullRequests.some((linkedPullRequest) => linkedPullRequest?.number === pullRequestNumber);
}

/**
 * Determine whether a check-run matches this review idempotency key.
 *
 * @param {{id?: number, name?: string, external_id?: string | null, pull_requests?: Array<{number?: number}>}} checkRun
 * @param {number} pullRequestNumber
 * @param {string} reviewIdempotencyKey
 * @returns {boolean}
 */
function checkRunMatchesReviewKey(checkRun, pullRequestNumber, reviewIdempotencyKey) {
  if (checkRun?.name !== REVIEW_CHECK_NAME) {
    return false;
  }

  const externalId = typeof checkRun.external_id === 'string'
    ? checkRun.external_id.trim()
    : '';

  if (externalId.length > 0) {
    return externalId === reviewIdempotencyKey;
  }

  return checkRunMatchesPullRequest(checkRun, pullRequestNumber);
}

/**
 * Find an existing bot review check run for the same PR + ref.
 *
 * Considers in-progress and completed runs to prevent redelivery duplicates.
 *
 * @param {Array<{id?: number, name?: string, status?: string, conclusion?: string | null, external_id?: string | null, pull_requests?: Array<{number?: number}>}>} checkRuns
 * @param {number} pullRequestNumber
 * @param {string} reviewIdempotencyKey
 * @returns {{id?: number, name?: string, status?: string, conclusion?: string | null} | null}
 */
function findDuplicateReviewCheckRun(checkRuns, pullRequestNumber, reviewIdempotencyKey) {
  if (!Array.isArray(checkRuns) || checkRuns.length === 0) {
    return null;
  }

  for (const checkRun of checkRuns) {
    if (!checkRunMatchesReviewKey(checkRun, pullRequestNumber, reviewIdempotencyKey)) {
      continue;
    }

    return checkRun;
  }

  return null;
}

/**
 * Select a deterministic winner among duplicate check-runs.
 *
 * @param {Array<{id?: number}>} matchingCheckRuns
 * @returns {{id?: number} | null}
 */
function selectWinnerCheckRun(matchingCheckRuns) {
  if (!Array.isArray(matchingCheckRuns) || matchingCheckRuns.length === 0) {
    return null;
  }

  const sorted = [...matchingCheckRuns].sort((left, right) => {
    const leftId = typeof left?.id === 'number' ? left.id : Number.MAX_SAFE_INTEGER;
    const rightId = typeof right?.id === 'number' ? right.id : Number.MAX_SAFE_INTEGER;
    return leftId - rightId;
  });

  return sorted[0] ?? null;
}

/**
 * Determine if duplicate-verification errors should fail closed.
 *
 * @returns {boolean}
 */
function shouldFailClosedOnDuplicateCheckError() {
  return !ALLOW_DUPLICATE_CHECK_FAIL_OPEN;
}

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
 * @param {'opened' | 'synchronize' | 'assigned'} triggerSource - Trigger source
 * @returns {Promise<void>}
 */
async function runReview(context, config, pr, triggerSource) {
  const headSha = pr.head.sha;
  if (!headSha) {
    debug('PR missing head SHA — skipping review');
    return;
  }

  const reviewIdempotencyKey = buildReviewLockKey(context, pr, headSha);
  const reviewLockKey = reviewIdempotencyKey;
  if (activeReviewLocks.has(reviewLockKey)) {
    debug(`Skipping duplicate review for ${reviewLockKey}: lock already active`);
    return;
  }

  activeReviewLocks.add(reviewLockKey);

  /** @type {number | null} */
  let checkRunId = null;

  try {
    if (hasSeenReviewHeadKey(reviewIdempotencyKey)) {
      debug(`Skipping duplicate review for ${reviewLockKey}: already handled in this process`);
      return;
    }

    const existingCheckRuns = await listReviewCheckRunsWithRetry(context, headSha);
    if (!existingCheckRuns) {
      if (shouldFailClosedOnDuplicateCheckError()) {
        warn(
          `Skipping ${triggerSource}-trigger review for PR #${pr.number} (head ${headSha}) because duplicate verification failed after retries (fail-closed default). Set OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN=true to override.`,
        );
        return;
      }

      warn(
        `Proceeding with ${triggerSource}-trigger review for PR #${pr.number} (head ${headSha}) despite duplicate verification failure because OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN=true.`,
      );
    } else {
      const duplicateCheckRun = findDuplicateReviewCheckRun(
        existingCheckRuns,
        pr.number,
        reviewIdempotencyKey,
      );
      if (duplicateCheckRun) {
        markSeenReviewHeadKey(reviewIdempotencyKey);
        debug(
          `Skipping duplicate review for PR #${pr.number} at ${headSha}: existing check run status=${duplicateCheckRun.status ?? 'unknown'} conclusion=${duplicateCheckRun.conclusion ?? 'n/a'}`,
        );
        return;
      }
    }

    checkRunId = await startReview(context, headSha, reviewIdempotencyKey);

    const postCreateCheckRuns = await listReviewCheckRunsWithRetry(context, headSha);
    if (!postCreateCheckRuns) {
      if (shouldFailClosedOnDuplicateCheckError()) {
        warn(
          `Marking review check ${checkRunId} as skipped for PR #${pr.number} because post-create duplicate barrier failed (fail-closed default).`,
        );
        try {
          await completeReview(
            context,
            checkRunId,
            'skipped',
            'Review skipped because duplicate-review verification failed after retries. Please re-trigger if needed.',
          );
        } catch (skipErr) {
          error(`Failed to mark duplicate-barrier skip for check run ${checkRunId}`, skipErr);
        }
        markSeenReviewHeadKey(reviewIdempotencyKey);
        return;
      }

      warn(
        `Continuing review for PR #${pr.number} because post-create duplicate barrier failed and OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN=true.`,
      );
    } else {
      const matchingPostCreateRuns = postCreateCheckRuns.filter((checkRun) =>
        checkRunMatchesReviewKey(checkRun, pr.number, reviewIdempotencyKey));

      if (matchingPostCreateRuns.length === 0) {
        if (shouldFailClosedOnDuplicateCheckError()) {
          warn(
            `Marking review check ${checkRunId} as skipped for PR #${pr.number} because no matching run was visible after creation (fail-closed default).`,
          );
          try {
            await completeReview(
              context,
              checkRunId,
              'skipped',
              'Review skipped because idempotency winner could not be confirmed safely.',
            );
          } catch (skipErr) {
            error(`Failed to mark missing-winner skip for check run ${checkRunId}`, skipErr);
          }
          markSeenReviewHeadKey(reviewIdempotencyKey);
          return;
        }

        warn(
          `No matching post-create check-runs found for PR #${pr.number}; continuing due fail-open override OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN=true.`,
        );
      } else {
        const winnerRun = selectWinnerCheckRun(matchingPostCreateRuns);
        if (typeof winnerRun?.id !== 'number') {
          if (shouldFailClosedOnDuplicateCheckError()) {
            warn(
              `Marking review check ${checkRunId} as skipped for PR #${pr.number} because idempotency winner was not deterministically identifiable (fail-closed default).`,
            );
            try {
              await completeReview(
                context,
                checkRunId,
                'skipped',
                'Review skipped because idempotency winner could not be identified safely.',
              );
            } catch (skipErr) {
              error(`Failed to mark unknown-winner skip for check run ${checkRunId}`, skipErr);
            }
            markSeenReviewHeadKey(reviewIdempotencyKey);
            return;
          }

          warn(
            `Idempotency winner for PR #${pr.number} was not deterministically identifiable; continuing because OPENCODE_PRO_DUPLICATE_CHECK_FAIL_OPEN=true.`,
          );
        } else if (winnerRun.id !== checkRunId) {
          debug(
            `Check run ${checkRunId} lost idempotency race for PR #${pr.number}; winner is ${winnerRun.id}. Marking current run as skipped.`,
          );
          try {
            await completeReview(
              context,
              checkRunId,
              'skipped',
              `Duplicate review instance detected for this PR head SHA. Winner check run: ${winnerRun.id}.`,
            );
          } catch (skipErr) {
            error(`Failed to mark losing check run ${checkRunId} as skipped`, skipErr);
          }
          markSeenReviewHeadKey(reviewIdempotencyKey);
          return;
        }
      }
    }

    markSeenReviewHeadKey(reviewIdempotencyKey);

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

    if (!checkRunId) {
      return;
    }

    try {
      await completeReview(
        context,
        checkRunId,
        'failure',
        'Review failed due to an internal error. Please try again later.',
      );
    } catch (completionErr) {
      error(`Failed to persist failure check-run for PR #${pr.number}`, completionErr);
    }
  } finally {
    activeReviewLocks.delete(reviewLockKey);
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
  await runReview(context, config, pr, 'opened');
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
  await runReview(context, config, pr, 'synchronize');
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
  await runReview(context, config, pr, 'assigned');
}
