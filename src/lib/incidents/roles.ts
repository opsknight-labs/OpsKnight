/**
 * Built-in incident role catalog. Roles live in code (not the database) so every surface
 * (web, ChatOps, API, MCP) agrees on keys, labels and rights. One holder per role per incident.
 *
 * - `operator` roles (commander, ops lead) may work the incident like its assignee, including
 *   private incidents.
 * - `contributor` roles (comms lead, scribe) may read the incident and add notes, not ack/resolve.
 */
export const INCIDENT_ROLE_KEYS = ['COMMANDER', 'OPS_LEAD', 'COMMS_LEAD', 'SCRIBE'] as const;

export type IncidentRoleKey = (typeof INCIDENT_ROLE_KEYS)[number];

export type IncidentRoleRights = 'operator' | 'contributor';

export interface IncidentRoleDefinition {
  key: IncidentRoleKey;
  label: string;
  shortLabel: string;
  description: string;
  rights: IncidentRoleRights;
}

export const INCIDENT_ROLES: readonly IncidentRoleDefinition[] = [
  {
    key: 'COMMANDER',
    label: 'Incident commander',
    shortLabel: 'Commander',
    description: 'Owns the response, makes the calls and decides when it is over.',
    rights: 'operator',
  },
  {
    key: 'OPS_LEAD',
    label: 'Operations lead',
    shortLabel: 'Ops lead',
    description: 'Leads the technical investigation and the fix.',
    rights: 'operator',
  },
  {
    key: 'COMMS_LEAD',
    label: 'Communications lead',
    shortLabel: 'Comms lead',
    description: 'Keeps stakeholders and the status page up to date.',
    rights: 'contributor',
  },
  {
    key: 'SCRIBE',
    label: 'Scribe',
    shortLabel: 'Scribe',
    description: 'Records decisions and key events on the timeline.',
    rights: 'contributor',
  },
];

const BY_KEY = new Map(INCIDENT_ROLES.map(role => [role.key, role]));

export function isIncidentRoleKey(value: unknown): value is IncidentRoleKey {
  return typeof value === 'string' && BY_KEY.has(value as IncidentRoleKey);
}

export function getIncidentRole(key: IncidentRoleKey): IncidentRoleDefinition {
  return BY_KEY.get(key)!;
}

const ROLE_ALIASES = new Map<string, IncidentRoleKey>([
  ['IC', 'COMMANDER'],
  ['INCIDENT_COMMANDER', 'COMMANDER'],
  ['OPS', 'OPS_LEAD'],
  ['OPERATIONS_LEAD', 'OPS_LEAD'],
  ['TECH_LEAD', 'OPS_LEAD'],
  ['COMMS', 'COMMS_LEAD'],
  ['COMMUNICATIONS_LEAD', 'COMMS_LEAD'],
  ['NOTES', 'SCRIBE'],
]);

/** Accepts `commander`, `ops-lead`, `ops_lead`, `Comms lead`, `ic` and similar user input. */
export function parseIncidentRoleKey(raw: string): IncidentRoleKey | null {
  const normalized = raw
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (isIncidentRoleKey(normalized)) return normalized;
  return ROLE_ALIASES.get(normalized) ?? null;
}

export type IncidentRoleHolder = { roleKey: string; userId: string };

/** Role holders that get operator rights on the incident (commander, ops lead). */
export function roleOperatorIds(assignments: readonly IncidentRoleHolder[] | undefined): string[] {
  return (assignments ?? [])
    .filter(a => isIncidentRoleKey(a.roleKey) && getIncidentRole(a.roleKey).rights === 'operator')
    .map(a => a.userId);
}

/** Role holders that may read and add notes (comms lead, scribe). */
export function roleContributorIds(
  assignments: readonly IncidentRoleHolder[] | undefined
): string[] {
  return (assignments ?? [])
    .filter(
      a => isIncidentRoleKey(a.roleKey) && getIncidentRole(a.roleKey).rights === 'contributor'
    )
    .map(a => a.userId);
}

/** Reads `IncidentTemplate.defaultRoles` (`{ COMMANDER: userId, ... }`), dropping unknown keys. */
export function parseDefaultRoles(
  value: unknown
): Array<{ roleKey: IncidentRoleKey; userId: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([roleKey, userId]) =>
    isIncidentRoleKey(roleKey) && typeof userId === 'string' && userId.trim()
      ? [{ roleKey, userId: userId.trim() }]
      : []
  );
}

/** Prisma `include`/`select` fragment for the relations the policy engine reads. */
export const INCIDENT_ROLE_RELATION_SELECT = { select: { roleKey: true, userId: true } } as const;

/** Policy-resource fields derived from an incident's role assignments. */
export function incidentRoleRelations(assignments: readonly IncidentRoleHolder[] | undefined) {
  return {
    roleOperatorIds: roleOperatorIds(assignments),
    roleContributorIds: roleContributorIds(assignments),
  };
}

export type IncidentRoleSummary = {
  roleKey: IncidentRoleKey;
  label: string;
  shortLabel: string;
  name: string;
};

/** Role holders in catalog order, for cards, topics and `/incident roles`. */
export function summarizeIncidentRoles(
  assignments: ReadonlyArray<{ roleKey: string; user: { name: string } | null }> | undefined
): IncidentRoleSummary[] {
  const byKey = new Map((assignments ?? []).map(a => [a.roleKey, a.user?.name ?? null]));
  return INCIDENT_ROLES.flatMap(role => {
    const name = byKey.get(role.key);
    return name
      ? [{ roleKey: role.key, label: role.label, shortLabel: role.shortLabel, name }]
      : [];
  });
}

/** Prisma fragment that loads role holders with their display names. */
export const INCIDENT_ROLE_SUMMARY_SELECT = {
  select: { roleKey: true, user: { select: { name: true } } },
} as const;
