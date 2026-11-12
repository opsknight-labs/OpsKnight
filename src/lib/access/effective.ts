/**
 * Effective access = built-in role + optional custom role + active temporary grants.
 *
 * Pure and deterministic so it can be unit tested exhaustively and reused by every actor
 * resolver (session pages, server actions, REST, MCP, ChatOps).
 */
import {
  CAPABILITIES,
  effectiveCapabilities,
  getRoleCapabilities,
  isAppRole,
  type AppRole,
  type Capability,
} from '@/lib/authorization';

export type ActiveGrantSource = {
  id: string;
  role: string | null;
  incidentId: string | null;
  expiresAt: Date;
  revokedAt?: Date | null;
  source?: string;
};

export type CustomRoleSource = {
  id: string;
  name: string;
  capabilities: readonly string[];
  archivedAt: Date | null;
} | null;

export type AccessPolicySettings = {
  /** When false, people without operations access cannot work incidents (view-only). */
  userIncidentActionsEnabled: boolean;
};

export const DEFAULT_ACCESS_POLICY_SETTINGS: AccessPolicySettings = {
  userIncidentActionsEnabled: true,
};

/** Rank used only to pick a single display/legacy role; permissions are always the union. */
const ROLE_RANK = new Map<AppRole, number>([
  ['USER', 0],
  ['AUDITOR', 1],
  ['RESPONDER', 2],
  ['ADMIN', 3],
]);

const SCOPED_INCIDENT_OPERATOR_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED,
  CAPABILITIES.INCIDENT_NOTE_SCOPED,
  CAPABILITIES.INCIDENT_ESCALATE_SCOPED,
  CAPABILITIES.INCIDENT_RESOLVE_SCOPED,
];

export type EffectiveAccess = {
  baseRole: AppRole;
  /** Highest of the base role and any active organization-wide grant. */
  role: AppRole;
  capabilities: ReadonlySet<Capability>;
  customRole: { id: string; name: string } | null;
  activeGrants: { id: string; role: AppRole | null; incidentId: string | null; expiresAt: Date }[];
  elevatedIncidentIds: string[];
};

export function isGrantActive(grant: ActiveGrantSource, now: Date = new Date()): boolean {
  return !grant.revokedAt && grant.expiresAt.getTime() > now.getTime();
}

export function resolveEffectiveAccess(
  input: {
    role: AppRole;
    customRole?: CustomRoleSource;
    accessGrants?: readonly ActiveGrantSource[];
  },
  settings: AccessPolicySettings = DEFAULT_ACCESS_POLICY_SETTINGS,
  now: Date = new Date()
): EffectiveAccess {
  const activeGrants = (input.accessGrants ?? [])
    .filter(grant => isGrantActive(grant, now))
    .map(grant => ({
      id: grant.id,
      role: isAppRole(grant.role) ? grant.role : null,
      incidentId: grant.incidentId,
      expiresAt: grant.expiresAt,
    }));

  const orgGrantRoles = activeGrants
    .filter(grant => grant.role && !grant.incidentId)
    .map(grant => grant.role as AppRole);

  const role = [input.role, ...orgGrantRoles].reduce((highest, candidate) =>
    (ROLE_RANK.get(candidate) ?? 0) > (ROLE_RANK.get(highest) ?? 0) ? candidate : highest
  );

  const customRole = input.customRole && !input.customRole.archivedAt ? input.customRole : null;

  const capabilities = new Set(
    effectiveCapabilities(input.role, customRole?.capabilities as readonly Capability[] | undefined)
  );
  // Grants carry a full built-in role, including Admin for just-in-time administration.
  for (const grantRole of orgGrantRoles) {
    for (const capability of getRoleCapabilities(grantRole)) capabilities.add(capability);
  }

  if (!settings.userIncidentActionsEnabled && !capabilities.has(CAPABILITIES.OPERATIONS_MANAGE)) {
    for (const capability of SCOPED_INCIDENT_OPERATOR_CAPABILITIES) capabilities.delete(capability);
  }

  return {
    baseRole: input.role,
    role,
    capabilities,
    customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
    activeGrants,
    elevatedIncidentIds: activeGrants
      .filter(grant => grant.incidentId)
      .map(grant => grant.incidentId as string),
  };
}

/** Prisma `select` fragment that loads everything `resolveEffectiveAccess` needs. */
export function effectiveAccessSelect(now: Date = new Date()) {
  return {
    customRole: { select: { id: true, name: true, capabilities: true, archivedAt: true } },
    accessGrants: {
      where: { revokedAt: null, expiresAt: { gt: now } },
      select: { id: true, role: true, incidentId: true, expiresAt: true, revokedAt: true },
    },
  } as const;
}
