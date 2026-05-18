/**
 * Command authorization policy.
 *
 * Applies trust checks before executing expensive or privileged command flows.
 *
 * @module handlers/command-authorization
 */

/**
 * Trusted author associations allowed to execute command triggers.
 *
 * Policy: slash commands and mentions are limited to repository OWNER,
 * MEMBER, and COLLABORATOR.
 *
 * @type {Set<string>}
 */
export const TRUSTED_SLASH_COMMAND_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

/**
 * Determine whether an author association is trusted by policy.
 *
 * @param {string | undefined | null} authorAssociation
 * @returns {boolean}
 */
export function isTrustedAuthorAssociation(authorAssociation) {
  if (typeof authorAssociation !== 'string' || authorAssociation.trim().length === 0) {
    return false;
  }

  return TRUSTED_SLASH_COMMAND_ASSOCIATIONS.has(authorAssociation.toUpperCase());
}

/**
 * Determine whether a detected command trigger is authorized to execute.
 *
 * Slash commands and mention triggers require trusted association. Auto
 * triggers are handled by explicit assignment events and remain allowed.
 *
 * @param {'slash' | 'mention' | 'auto' | null} triggerType
 * @param {string | undefined | null} authorAssociation
 * @returns {boolean}
 */
export function isCommandExecutionAuthorized(triggerType, authorAssociation) {
  if (triggerType === 'auto') {
    return true;
  }

  if (triggerType !== 'slash' && triggerType !== 'mention') {
    return false;
  }

  return isTrustedAuthorAssociation(authorAssociation);
}
