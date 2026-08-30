import type { AuditEntityType } from '@prisma/client';

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'TEAM',
  'TEAM_MEMBER',
  'SERVICE',
  'ESCALATION_POLICY',
  'API_KEY',
  'SSO_CONFIG',
  'SCHEDULE',
  'CUSTOM_FIELD',
  'STATUS_PAGE',
  'SYSTEM_CONFIG',
] as const satisfies readonly AuditEntityType[];

function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

export function parseAuditEntityType(value?: string): AuditEntityType | undefined {
  return value && isAuditEntityType(value) ? value : undefined;
}
