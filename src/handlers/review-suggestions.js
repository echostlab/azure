/**
 * Inline PR Review Suggestions for OpenCode Pro.
 *
 * Parses AI-generated review output and posts it as structured, inline
 * GitHub PR review comments positioned at specific lines within the diff.
 * Supports single-line, multi-line, and review-body suggestions.
 *
 * AI output format expected:
 *   FILE: path/to/file.js
 *   LINE: 42
 *   COMMENT: your suggestion here
 *
 * @module handlers/review-suggestions
 */

import { debug, error } from '../utils/logger.js';

/**
 * @typedef {object} ReviewSuggestion
 * @property {string} path - File path relative to repo root
 * @property {number} line - Target line number in the diff
 * @property {string} body - The suggestion / comment text
 * @property {'RIGHT' | 'LEFT'} [side] - Diff side (default RIGHT)
 * @property {number} [startLine] - For multi-line comments, the starting line
 * @property {'RIGHT' | 'LEFT'} [startSide] - Side for the starting line
 */

/**
 * Parse an AI-generated response string into structured review suggestions.
 *
 * Recognises blocks delimited by `FILE:`, `LINE:`, and `COMMENT:` tokens.
 * Supports multi-line suggestions with `START_LINE` and `END_LINE`, and
 * optional `SIDE` specification.
 *
 * Expected AI output format:
 * ```
 * FILE: src/utils/parser.js
 * LINE: 42
 * COMMENT: This function could be simplified by using a guard clause.
 *
 * FILE: src/handlers/router.js
 * START_LINE: 15
 * END_LINE: 22
 * COMMENT: Consider extracting this block into its own function
 * for better readability and testability.
 * ```
 *
 * @param {string} response - The raw AI response text
 * @returns {ReviewSuggestion[]} Parsed suggestions ready for review posting
 */
export function parseSuggestionsFromAI(response) {
  if (typeof response !== 'string' || response.length === 0) {
    return [];
  }

  /** @type {ReviewSuggestion[]} */
  const suggestions = [];

  // Split on FILE: token to get individual suggestion blocks
  const blocks = response.split(/\n\s*(?=FILE:)/);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;

    const pathMatch = trimmed.match(/^FILE:\s*(.+)$/m);
    if (!pathMatch) continue;

    const filePath = pathMatch[1].trim();
    if (filePath.length === 0) continue;

    // Check for multi-line range vs single-line
    const startLineMatch = trimmed.match(/START_LINE:\s*(\d+)/i);
    const endLineMatch = trimmed.match(/END_LINE:\s*(\d+)/i);
    const singleLineMatch = trimmed.match(/^LINE:\s*(\d+)$/m);

    const commentMatch = trimmed.match(/^COMMENT:\s*([\s\S]+)$/m);

    if (!commentMatch) continue;

    const body = commentMatch[1].trim();
    if (body.length === 0) continue;

    const sideMatch = trimmed.match(/^SIDE:\s*(LEFT|RIGHT)$/im);

    if (startLineMatch && endLineMatch) {
      // Multi-line suggestion
      suggestions.push({
        path: filePath,
        line: parseInt(endLineMatch[1], 10),
        startLine: parseInt(startLineMatch[1], 10),
        body,
        side: 'RIGHT',
        startSide: sideMatch ? /** @type {'LEFT' | 'RIGHT'} */ (sideMatch[1].toUpperCase()) : 'RIGHT',
      });
    } else if (singleLineMatch) {
      // Single-line suggestion
      suggestions.push({
        path: filePath,
        line: parseInt(singleLineMatch[1], 10),
        body,
        side: sideMatch ? /** @type {'LEFT' | 'RIGHT'} */ (sideMatch[1].toUpperCase()) : 'RIGHT',
      });
    } else {
      // No line specified — skip this suggestion
      debug(`Suggestion for ${filePath} has no line information, skipping`);
      continue;
    }
  }

  return suggestions;
}

/**
 * Resolve the latest commit SHA on a pull request.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} pullNumber - PR number
 * @returns {Promise<string>}
 */
async function getLatestCommitSha(context, pullNumber) {
  if (!pullNumber) {
    throw new Error('getLatestCommitSha: pullNumber is required');
  }

  const { data: pr } = await context.octokit.pulls.get(
    context.repo({ pull_number: pullNumber }),
  );

  if (!pr?.head?.sha) {
    throw new Error(`Could not resolve head SHA for PR #${pullNumber}`);
  }

  return pr.head.sha;
}

/**
 * Create a full GitHub PR review with inline comments at specific line positions.
 *
 * Posts suggestions as structured inline review comments.  Supports single
 * comments, multi-line range comments, and an optional review body.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} pullNumber - PR number to review
 * @param {ReviewSuggestion[]} suggestions - Array of structured suggestions
 * @param {string} [reviewBody] - Optional overall review body text
 * @returns {Promise<object>} The created review response from the API
 */
export async function createPRReview(context, pullNumber, suggestions, reviewBody) {
  if (!pullNumber) {
    throw new Error('createPRReview: pullNumber is required');
  }

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    debug('No suggestions to post — skipping review creation');
    throw new Error('createPRReview: suggestions array is required and must not be empty');
  }

  debug(`Creating PR review for #${pullNumber} with ${suggestions.length} inline suggestions`);

  try {
    const commitId = await getLatestCommitSha(context, pullNumber);

    // Build the comments array — only include suggestions with valid path + line
    /** @type {Array<{path: string, line: number, side: string, body: string, start_line?: number, start_side?: string}>} */
    const comments = [];

    for (const suggestion of suggestions) {
      if (!suggestion.path || !suggestion.line) continue;

      /** @type {{path: string, line: number, side: string, body: string, start_line?: number, start_side?: string}} */
      const comment = {
        path: suggestion.path,
        line: suggestion.line,
        side: suggestion.side ?? 'RIGHT',
        body: suggestion.body,
      };

      if (suggestion.startLine) {
        comment.start_line = suggestion.startLine;
        comment.start_side = suggestion.startSide ?? 'RIGHT';
      }

      comments.push(comment);
    }

    if (comments.length === 0) {
      debug('No valid suggestions after filtering');
      throw new Error('createPRReview: no valid suggestions after filtering');
    }

    const reviewParams = {
      ...context.repo(),
      pull_number: pullNumber,
      commit_id: commitId,
      event: 'COMMENT',
      comments,
    };

    if (reviewBody && reviewBody.length > 0) {
      reviewParams.body = reviewBody;
    }

    const { data: review } = await context.octokit.pulls.createReview(reviewParams);
    debug(`PR review created: id=${review.id}, comments=${comments.length}`);

    return review;
  } catch (err) {
    error(`Failed to create PR review for #${pullNumber}`, err);
    throw err;
  }
}
