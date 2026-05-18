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

  it('blocks mention triggers from untrusted authors', () => {
    expect(isCommandExecutionAuthorized('mention', 'NONE')).toBe(false);
    expect(isCommandExecutionAuthorized('mention', undefined)).toBe(false);
  });

  it('allows trusted mention triggers', () => {
    expect(isCommandExecutionAuthorized('mention', 'OWNER')).toBe(true);
    expect(isCommandExecutionAuthorized('mention', 'MEMBER')).toBe(true);
  });

  it('allows explicit auto triggers and rejects unknown trigger kinds', () => {
    expect(isCommandExecutionAuthorized('auto', 'NONE')).toBe(true);
    expect(isCommandExecutionAuthorized(null, 'OWNER')).toBe(false);
  });
});
