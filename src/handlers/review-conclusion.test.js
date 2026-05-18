import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  mapReviewSummaryToCheckConclusion,
  normalizeCheckConclusion,
} from './review-conclusion.js';

describe('review conclusion mapping', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('handles non-string summary input safely', () => {
    expect(mapReviewSummaryToCheckConclusion(/** @type {any} */ (null))).toBe('neutral');
    expect(mapReviewSummaryToCheckConclusion(/** @type {any} */ (42), 'failure')).toBe('failure');
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

  it('parses conclusion tokens case-insensitively', () => {
    const summary = 'Detailed feedback\n\nconclusion: aPpRoVe';
    expect(mapReviewSummaryToCheckConclusion(summary)).toBe('success');
  });

  it('uses deterministic neutral fallback and warns when fallback is invalid', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = normalizeCheckConclusion('not-valid', 'also-invalid');

    expect(result).toBe('neutral');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults to neutral when fallback argument is omitted', () => {
    expect(normalizeCheckConclusion('not-valid')).toBe('neutral');
  });
});
