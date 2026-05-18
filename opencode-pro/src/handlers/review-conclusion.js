/**
 * Review conclusion parsing and GitHub Check conclusion normalization.
 *
 * @module handlers/review-conclusion
 */

/**
 * Valid GitHub Checks API conclusions.
 *
 * @type {Set<string>}
 */
export const VALID_CHECK_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'success',
  'skipped',
  'stale',
  'startup_failure',
  'timed_out',
]);

/**
 * Map human review tokens to GitHub Check conclusions.
 *
 * @type {Record<string, string>}
 */
const REVIEW_TOKEN_TO_CHECK_CONCLUSION = {
  approve: 'success',
  reject: 'failure',
  comment: 'neutral',
};

/**
 * Extract the intended review token from model output.
 *
 * Strategy:
 * 1) Prefer the last strict line: `CONCLUSION: <TOKEN>`
 * 2) Fall back to the last loose occurrence in text
 *
 * @param {string} summary
 * @returns {'approve' | 'reject' | 'comment' | null}
 */
function extractConclusionToken(summary) {
  const lines = summary.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const lineMatch = lines[index].match(/^\s*CONCLUSION:\s*(APPROVE|REJECT|COMMENT)\s*$/i);
    if (lineMatch) {
      return /** @type {'approve' | 'reject' | 'comment'} */ (lineMatch[1].toLowerCase());
    }
  }

  const matches = [...summary.matchAll(/CONCLUSION:\s*(APPROVE|REJECT|COMMENT)\b/gi)];
  if (matches.length === 0) {
    return null;
  }

  const lastMatch = matches[matches.length - 1];
  return /** @type {'approve' | 'reject' | 'comment'} */ (lastMatch[1].toLowerCase());
}

/**
 * Normalize an arbitrary conclusion into a valid GitHub Checks conclusion.
 *
 * @param {string} conclusion
 * @param {string} [fallback='neutral']
 * @returns {string}
 */
export function normalizeCheckConclusion(conclusion, fallback = 'neutral') {
  const normalized = typeof conclusion === 'string' ? conclusion.toLowerCase() : '';
  if (VALID_CHECK_CONCLUSIONS.has(normalized)) {
    return normalized;
  }

  return VALID_CHECK_CONCLUSIONS.has(fallback) ? fallback : 'neutral';
}

/**
 * Map review summary output into a valid GitHub Check conclusion.
 *
 * The model is expected to finish with one of:
 *   - `CONCLUSION: APPROVE`
 *   - `CONCLUSION: REJECT`
 *   - `CONCLUSION: COMMENT`
 *
 * @param {string} summary
 * @param {string} [fallback='neutral']
 * @returns {string}
 */
export function mapReviewSummaryToCheckConclusion(summary, fallback = 'neutral') {
  if (typeof summary !== 'string' || summary.length === 0) {
    return normalizeCheckConclusion(fallback);
  }

  const reviewToken = extractConclusionToken(summary);
  if (!reviewToken) {
    return normalizeCheckConclusion(fallback);
  }

  const mappedConclusion = REVIEW_TOKEN_TO_CHECK_CONCLUSION[reviewToken];
  return normalizeCheckConclusion(mappedConclusion, fallback);
}
