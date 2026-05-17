/**
 * GitHub API helper utilities.
 *
 * Thin wrappers around the Octokit context for common operations:
 * commenting on issues/PRs, creating check runs, fetching file contents.
 *
 * @module utils/github
 */

import { info, error } from './logger.js';

/**
 * Post a comment on an issue or pull request.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} issueNumber - Issue or PR number
 * @param {string} body - Markdown comment body
 * @returns {Promise<void>}
 */
export async function createComment(context, issueNumber, body) {
  if (!issueNumber || !body) {
    throw new Error('createComment: issueNumber and body are required');
  }

  try {
    await context.octokit.issues.createComment(
      context.repo({ issue_number: issueNumber, body }),
    );
    info(`Comment posted on #${issueNumber}`);
  } catch (err) {
    error(`Failed to post comment on #${issueNumber}`, err);
    throw err;
  }
}

/**
 * Fetch the diff for a pull request.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} pullNumber - PR number
 * @returns {Promise<string>} The unified diff as a string
 */
export async function getPullRequestDiff(context, pullNumber) {
  if (!pullNumber) {
    throw new Error('getPullRequestDiff: pullNumber is required');
  }

  const { data: diff } = await context.octokit.pulls.get({
    ...context.repo(),
    pull_number: pullNumber,
    mediaType: { format: 'diff' },
  });

  return String(diff);
}

/**
 * Fetch the full tree of changed files in a pull request with their contents.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} pullNumber - PR number
 * @returns {Promise<Array<{filename: string, patch: string}>>}
 */
export async function getPullRequestFiles(context, pullNumber) {
  if (!pullNumber) {
    throw new Error('getPullRequestFiles: pullNumber is required');
  }

  const { data: files } = await context.octokit.pulls.listFiles({
    ...context.repo(),
    pull_number: pullNumber,
    per_page: 100,
  });

  if (!Array.isArray(files)) {
    return [];
  }

  return files.map(({ filename, patch }) => ({
    filename,
    patch: patch ?? '',
  }));
}

/**
 * Create a check run for a PR review.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {object} opts - Check run options
 * @param {string} opts.headSha - Commit SHA
 * @param {string} opts.name - Check run name
 * @param {string} [opts.status] - 'queued' | 'in_progress' | 'completed'
 * @param {string} [opts.conclusion] - Outcome when completed
 * @param {object} [opts.output] - Check run output {title, summary, text}
 * @returns {Promise<import('@octokit/rest').RestEndpointMethodTypes['checks']['create']['response']['data']>}
 */
export async function createCheckRun(context, opts) {
  const { headSha, name, status, conclusion, output } = opts;

  if (!headSha || !name) {
    throw new Error('createCheckRun: headSha and name are required');
  }

  const params = {
    ...context.repo(),
    head_sha: headSha,
    name,
    status: status ?? 'queued',
  };

  if (conclusion) params.conclusion = conclusion;
  if (output) params.output = output;

  const { data } = await context.octokit.checks.create(params);
  return data;
}

/**
 * Update an existing check run (e.g. mark as completed).
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} checkRunId - Existing check run ID
 * @param {object} opts - Fields to update
 * @param {string} [opts.status]
 * @param {string} [opts.conclusion]
 * @param {object} [opts.output]
 * @returns {Promise<void>}
 */
export async function updateCheckRun(context, checkRunId, opts) {
  if (!checkRunId) {
    throw new Error('updateCheckRun: checkRunId is required');
  }

  await context.octokit.checks.update({
    ...context.repo(),
    check_run_id: checkRunId,
    ...opts,
  });
}

/**
 * Read a file from the repository at a given ref.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {string} path - File path relative to repo root
 * @param {string} [ref] - Git ref (branch, SHA); defaults to default branch
 * @returns {Promise<string | null>} File contents as UTF-8, or null if not found
 */
export async function readRepoFile(context, path, ref) {
  if (!path) {
    throw new Error('readRepoFile: path is required');
  }

  try {
    const params = { ...context.repo(), path };
    if (ref) params.ref = ref;

    const { data } = await context.octokit.repos.getContent(params);
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}