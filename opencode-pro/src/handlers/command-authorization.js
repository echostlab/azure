/**
 * Command authorization policy.
 *
 * Applies trust checks before executing expensive or privileged command flows.
 *
 * @module handlers/command-authorization
 */

/**
 * Trusted author associations allowed to execute slash commands.
 *
 * Policy: `/oc` is limited to repository OWNER, MEMBER, and COLLABORATOR.
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
 * Slash commands require trusted association. Mention-based triggers keep
 * existing behaviour and are not blocked by this policy gate.
 *
 * @param {'slash' | 'mention' | 'auto' | null} triggerType
 * @param {string | undefined | null} authorAssociation
 * @returns {boolean}
 */
export function isCommandExecutionAuthorized(triggerType, authorAssociation) {
  if (triggerType !== 'slash') {
    return true;
  }

  return isTrustedAuthorAssociation(authorAssociation);
}
