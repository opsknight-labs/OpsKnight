import { AuditEntityType } from '@prisma/client';

// Derived from the Prisma enum so a new entity type is filterable without a second edit here;
// a hand-kept list silently ignored the types it forgot (PRIVACY_*, COMPLIANCE_*, INCIDENT, ...).
export const AUDIT_ENTITY_TYPES: readonly AuditEntityType[] = Object.values(AuditEntityType);

function isAuditEntityType(value: string): value is AuditEntityType {
  return (AUDIT_ENTITY_TYPES as readonly string[]).includes(value);
}

export function parseAuditEntityType(value?: string): AuditEntityType | undefined {
  return value && isAuditEntityType(value) ? value : undefined;
}
