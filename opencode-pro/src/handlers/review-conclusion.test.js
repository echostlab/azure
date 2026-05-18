import { describe, expect, it } from '@jest/globals';

import {
  mapReviewSummaryToCheckConclusion,
  normalizeCheckConclusion,
} from './review-conclusion.js';

describe('review conclusion mapping', () => {
  it('maps APPROVE token to success', () => {
    const summary = 'Looks good.\n\nCONCLUSION: APPROVE';
    expect(mapReviewSummaryToCheckConclusion(summary)).toBe('success');
  });

  it('maps REJECT token to failure', () => {
    const summary = 'Critical issues found.\n\nCONCLUSION: REJECT';
    expect(mapReviewSummaryToCheckConclusion(summary)).toBe('failure');
  });

  it('maps COMMENT token to neutral', () => {
    const summary = 'Needs discussion first.\n\nCONCLUSION: COMMENT';
    expect(mapReviewSummaryToCheckConclusion(summary)).toBe('neutral');
  });

  it('falls back safely to neutral when token missing', () => {
    expect(mapReviewSummaryToCheckConclusion('No conclusion token present')).toBe('neutral');
  });

  it('prefers the last strict conclusion line when multiple tokens exist', () => {
    const summary = [
      'The author wrote CONCLUSION: REJECT in a quoted log line.',
      '',
      'Final decision after full analysis:',
      'CONCLUSION: APPROVE',
    ].join('\n');

    expect(mapReviewSummaryToCheckConclusion(summary)).toBe('success');
  });

  it('normalizes only valid check conclusions', () => {
    expect(normalizeCheckConclusion('SUCCESS')).toBe('success');
    expect(normalizeCheckConclusion('not-valid')).toBe('neutral');
    expect(normalizeCheckConclusion('not-valid', 'failure')).toBe('failure');
  });
});
