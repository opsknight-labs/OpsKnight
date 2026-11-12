/**
 * Plain-language catalogue of every capability, and helpers that turn a capability
 * requirement into human text ("Requires Responder or Admin").
 *
 * Everything here is derived from the role definitions in `@/lib/authorization`, so the
 * text shown to people can never drift from what the server enforces. Client-safe.
 */
import {
  CAPABILITIES,
  getRoleCapabilities,
  roleLabel,
  type AppRole,
  type Capability,
} from '@/lib/authorization';

export type CapabilityGroup =
  | 'incidents'
  | 'services'
  | 'on_call'
  | 'runbooks'
  | 'reporting'
  | 'people'
  | 'governance'
  | 'administration';

export type CapabilityRisk = 'low' | 'medium' | 'high';

export type CapabilityInfo = {
  label: string;
  group: CapabilityGroup;
  risk: CapabilityRisk;
};

export const CAPABILITY_GROUP_LABELS: Record<CapabilityGroup, string> = {
  incidents: 'Incidents',
  services: 'Services & metrics',
  on_call: 'On-call & escalation',
  runbooks: 'Runbooks & automation',
  reporting: 'Reports & analytics',
  people: 'People & teams',
  governance: 'Governance & compliance',
  administration: 'Administration',
};

const C = CAPABILITIES;

/** Keyed by every capability: adding a capability without describing it fails typecheck. */
export const CAPABILITY_CATALOG: Record<Capability, CapabilityInfo> = {
  [C.ADMIN_MANAGE]: { label: 'Administer the organization', group: 'administration', risk: 'high' },
  [C.OPERATIONS_MANAGE]: {
    label: 'Manage incidents, services and schedules',
    group: 'incidents',
    risk: 'medium',
  },
  [C.INCIDENT_CREATE_ALL]: {
    label: 'Create incidents on any service',
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_CREATE_SCOPED]: {
    label: "Create incidents on your teams' services",
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_ACKNOWLEDGE_SCOPED]: {
    label: 'Acknowledge your incidents',
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_ESCALATE_SCOPED]: {
    label: 'Escalate your incidents',
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_RESOLVE_SCOPED]: { label: 'Resolve your incidents', group: 'incidents', risk: 'low' },
  [C.INCIDENT_NOTE_SCOPED]: {
    label: 'Add notes to your incidents',
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_READ_ALL]: { label: 'View every incident', group: 'incidents', risk: 'low' },
  [C.INCIDENT_READ_SCOPED]: {
    label: 'View incidents for your teams, or assigned to or watched by you',
    group: 'incidents',
    risk: 'low',
  },
  [C.INCIDENT_EXPORT]: { label: 'Export incidents', group: 'incidents', risk: 'medium' },
  [C.INCIDENT_SENSITIVE_READ]: {
    label: 'View sensitive incident details',
    group: 'incidents',
    risk: 'medium',
  },
  [C.SERVICE_READ_ALL]: { label: 'View every service', group: 'services', risk: 'low' },
  [C.SERVICE_READ_SCOPED]: { label: "View your teams' services", group: 'services', risk: 'low' },
  [C.METRICS_READ_ALL]: {
    label: 'View metrics for every service',
    group: 'services',
    risk: 'low',
  },
  [C.METRICS_READ_SCOPED]: { label: "View your teams' metrics", group: 'services', risk: 'low' },
  [C.SCHEDULE_READ_ALL]: { label: 'View every on-call schedule', group: 'on_call', risk: 'low' },
  [C.SCHEDULE_READ_SCOPED]: {
    label: 'View your on-call schedules',
    group: 'on_call',
    risk: 'low',
  },
  [C.POLICY_READ_ALL]: { label: 'View escalation policies', group: 'on_call', risk: 'low' },
  [C.AUDIT_READ]: { label: 'View the audit log', group: 'governance', risk: 'medium' },
  [C.AUDIT_EXPORT]: { label: 'Export the audit log', group: 'governance', risk: 'medium' },
  [C.POSTMORTEM_DRAFT_READ]: { label: 'View draft postmortems', group: 'incidents', risk: 'low' },
  [C.REPORT_READ]: { label: 'View reports and dashboards', group: 'reporting', risk: 'low' },
  [C.REPORT_EXPORT]: {
    label: 'Export reports and analytics',
    group: 'reporting',
    risk: 'medium',
  },
  [C.USER_READ_ALL]: { label: 'View the user directory', group: 'people', risk: 'low' },
  [C.USER_NOTIFICATION_PREFERENCES]: {
    label: 'Manage your notification preferences',
    group: 'people',
    risk: 'low',
  },
  [C.TEAM_ADMINISTER_SCOPED]: {
    label: 'Manage teams you own or administer',
    group: 'people',
    risk: 'medium',
  },
  [C.PRIVACY_READ]: { label: 'View privacy requests', group: 'governance', risk: 'medium' },
  [C.PRIVACY_REQUESTS_MANAGE]: {
    label: 'Manage privacy requests',
    group: 'governance',
    risk: 'high',
  },
  [C.PRIVACY_EXPORT]: { label: 'Export personal data', group: 'governance', risk: 'high' },
  [C.PRIVACY_ERASURE]: { label: 'Erase personal data', group: 'governance', risk: 'high' },
  [C.RETENTION_READ]: { label: 'View data retention settings', group: 'governance', risk: 'low' },
  [C.RETENTION_MANAGE]: { label: 'Change data retention', group: 'governance', risk: 'high' },
  [C.RETENTION_HOLDS_MANAGE]: { label: 'Manage legal holds', group: 'governance', risk: 'high' },
  [C.ENCRYPTION_READ]: { label: 'View encryption status', group: 'governance', risk: 'low' },
  [C.ENCRYPTION_MANAGE]: { label: 'Rotate encryption keys', group: 'governance', risk: 'high' },
  [C.COMPLIANCE_READ]: { label: 'View compliance controls', group: 'governance', risk: 'low' },
  [C.COMPLIANCE_EVALUATE]: {
    label: 'Run compliance checks',
    group: 'governance',
    risk: 'medium',
  },
  [C.COMPLIANCE_EVIDENCE_READ]: {
    label: 'View compliance evidence',
    group: 'governance',
    risk: 'medium',
  },
  [C.COMPLIANCE_EXPORT]: {
    label: 'Export compliance evidence',
    group: 'governance',
    risk: 'medium',
  },
  [C.COMPLIANCE_DRIFT_MANAGE]: {
    label: 'Manage compliance drift',
    group: 'governance',
    risk: 'medium',
  },
  [C.ACCESS_REVIEW_MANAGE]: {
    label: 'Run access reviews and manage custom roles',
    group: 'governance',
    risk: 'high',
  },
  [C.AUTOMATION_READ]: { label: 'View automations', group: 'runbooks', risk: 'low' },
  [C.AUTOMATION_EDIT]: { label: 'Edit automations', group: 'runbooks', risk: 'medium' },
  [C.AUTOMATION_PUBLISH]: { label: 'Publish automations', group: 'runbooks', risk: 'high' },
  [C.RUNBOOK_READ_ALL]: { label: 'View every runbook', group: 'runbooks', risk: 'low' },
  [C.RUNBOOK_READ_SCOPED]: { label: "View your teams' runbooks", group: 'runbooks', risk: 'low' },
  [C.RUNBOOK_EXECUTE]: { label: 'Run runbooks', group: 'runbooks', risk: 'medium' },
  [C.RUNBOOK_APPROVE]: { label: 'Approve runbook runs', group: 'runbooks', risk: 'medium' },
  [C.RUNBOOK_MANAGE]: { label: 'Write and edit runbooks', group: 'runbooks', risk: 'high' },
  [C.RUNBOOK_ARTIFACT_DOWNLOAD]: {
    label: 'Download runbook artifacts',
    group: 'runbooks',
    risk: 'medium',
  },
  [C.RUNBOOK_PUBLISH]: { label: 'Publish runbooks', group: 'runbooks', risk: 'high' },
  [C.RUNBOOK_AGENT_MANAGE]: { label: 'Manage runbook agents', group: 'runbooks', risk: 'high' },
  [C.RUNBOOK_SECRET_MANAGE]: { label: 'Manage runbook secrets', group: 'runbooks', risk: 'high' },
};

const CATALOG = new Map(Object.entries(CAPABILITY_CATALOG) as [Capability, CapabilityInfo][]);
const GROUP_LABELS = new Map(
  Object.entries(CAPABILITY_GROUP_LABELS) as [CapabilityGroup, string][]
);

/** Plain-language description of a capability. */
export function capabilityInfo(capability: Capability): CapabilityInfo {
  return CATALOG.get(capability) ?? { label: capability, group: 'administration', risk: 'high' };
}

export function capabilityGroupLabel(group: CapabilityGroup): string {
  return GROUP_LABELS.get(group) ?? group;
}

/** Every catalogued capability, in declaration order. */
export const ALL_CATALOGUED_CAPABILITIES: readonly Capability[] = [...CATALOG.keys()];
export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [...GROUP_LABELS.keys()];

const ROLE_ORDER: readonly AppRole[] = ['USER', 'AUDITOR', 'RESPONDER', 'ADMIN'];

function toList(capabilities: Capability | readonly Capability[]): Capability[] {
  return typeof capabilities === 'string' ? [capabilities] : [...capabilities];
}

/** Built-in roles that include at least one of `capabilities`, least privileged first. */
export function rolesGranting(capabilities: Capability | readonly Capability[]): AppRole[] {
  const required = toList(capabilities);
  return ROLE_ORDER.filter(role =>
    required.some(capability => getRoleCapabilities(role).includes(capability))
  );
}

function joinOr(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`;
}

export type Requirement = {
  /** Capabilities that would each satisfy the requirement. */
  anyOf: Capability[];
  /** Built-in roles that grant it, least privileged first. */
  roles: AppRole[];
  /** "Responder or Admin" */
  rolesText: string;
  /** "Run runbooks" */
  capabilityText: string;
  /** "Requires Responder or Admin" */
  summary: string;
};

export function describeRequirement(capabilities: Capability | readonly Capability[]): Requirement {
  const anyOf = toList(capabilities);
  const roles = rolesGranting(anyOf);
  const rolesText = roles.length > 0 ? joinOr(roles.map(roleLabel)) : 'a custom role';
  const capabilityText = joinOr(anyOf.map(capability => capabilityInfo(capability).label));
  return { anyOf, roles, rolesText, capabilityText, summary: `Requires ${rolesText}` };
}

export type CapabilityGroupView = {
  group: CapabilityGroup;
  label: string;
  items: { capability: Capability; info: CapabilityInfo }[];
};

/** Capabilities grouped for display, in a stable order. */
export function groupCapabilities(capabilities: readonly Capability[]): CapabilityGroupView[] {
  const unique = [...new Set(capabilities)].filter(capability => CATALOG.has(capability));
  return CAPABILITY_GROUPS.map(group => ({
    group,
    label: capabilityGroupLabel(group),
    items: unique
      .filter(capability => capabilityInfo(capability).group === group)
      .map(capability => ({ capability, info: capabilityInfo(capability) })),
  })).filter(entry => entry.items.length > 0);
}
