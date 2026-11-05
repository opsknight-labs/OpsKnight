/**
 * What the admin and consent screens say about assistant changes, in one place. Routine incident
 * actions (R1) run directly within the person's own permissions; everything else that changes
 * OpsKnight waits for a human. Static strings only, so this module is client-safe and changes no
 * contract hash. tests/mcp/policy-copy.test.ts checks every named action against the catalog and
 * fails if any screen claims that every change needs approval.
 */

/** Incident actions named in the copy; each must be a direct (R1) executable operation. */
export const MCP_DIRECT_INCIDENT_ACTIONS = [
  'acknowledge',
  'assign',
  'note',
  'resolve',
  'create',
  'tag',
  'watch',
] as const;

const actions = 'acknowledge, assign, add notes, resolve, create, tag and watch';

/** Access policy description of the writes switch. */
export const MCP_WRITE_MODE_SUMMARY = `Routine incident actions (${actions}) run directly within the person's own permissions. Configuration changes need an administrator's approval, and runbook runs need a runbook approver.`;

/** The scope selector group for change and run scopes. */
export const MCP_WRITE_SCOPE_GROUP_TITLE = 'Change incidents or propose changes';
export const MCP_WRITE_SCOPE_GROUP_DESCRIPTION =
  'Incident actions run directly; configuration changes and runbook runs wait for human approval.';

/** Header and overview tiles. */
export const MCP_WRITE_MODE_LABEL = 'Assistant changes';
export const MCP_WRITE_MODE_VALUE = { on: 'Direct + reviewed', off: 'Read only' } as const;
export const MCP_WRITE_MODE_HINT = {
  on: 'Incident actions direct; config and runbooks approved',
  off: 'Assistants cannot change anything',
} as const;

/** Consent page note while an administrator has changes turned off. */
export const MCP_CONSENT_WRITES_OFF_NOTE =
  'Changes are currently turned off by your administrator. Change permissions take effect only if changes are turned on; incident actions then run directly and other changes need approval.';

/** Matches the false claim this module replaced; the copy guard test uses it. */
export const MCP_FALSE_APPROVAL_CLAIM =
  /each (change|request) (still )?(needs|requires)|every change .*needs an administrator|admin(istrator)? approval before run/i;
