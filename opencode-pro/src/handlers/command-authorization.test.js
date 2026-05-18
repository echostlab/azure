import { describe, expect, it } from '@jest/globals';

import {
  isCommandExecutionAuthorized,
  isTrustedAuthorAssociation,
} from './command-authorization.js';

describe('command authorization policy', () => {
  it('allows trusted associations', () => {
    expect(isTrustedAuthorAssociation('OWNER')).toBe(true);
    expect(isTrustedAuthorAssociation('MEMBER')).toBe(true);
    expect(isTrustedAuthorAssociation('COLLABORATOR')).toBe(true);
  });

  it('rejects untrusted associations', () => {
    expect(isTrustedAuthorAssociation('CONTRIBUTOR')).toBe(false);
    expect(isTrustedAuthorAssociation('FIRST_TIMER')).toBe(false);
    expect(isTrustedAuthorAssociation('NONE')).toBe(false);
  });

  it('blocks slash commands from untrusted authors', () => {
    expect(isCommandExecutionAuthorized('slash', 'CONTRIBUTOR')).toBe(false);
    expect(isCommandExecutionAuthorized('slash', undefined)).toBe(false);
  });

  it('does not block mention triggers with untrusted associations', () => {
    expect(isCommandExecutionAuthorized('mention', 'NONE')).toBe(true);
    expect(isCommandExecutionAuthorized(null, 'NONE')).toBe(true);
  });
});
