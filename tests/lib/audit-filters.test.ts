import { describe, expect, it } from 'vitest';
import { AuditEntityType } from '@prisma/client';
import { AUDIT_ENTITY_TYPES, parseAuditEntityType } from '@/lib/audit-filters';

describe('audit entity filters', () => {
  it('accepts only entity types that Prisma can query', () => {
    expect(parseAuditEntityType('SYSTEM_CONFIG')).toBe('SYSTEM_CONFIG');
    expect(parseAuditEntityType('TEAM_MEMBER')).toBe('TEAM_MEMBER');
    expect(AUDIT_ENTITY_TYPES).toContain('SCHEDULE');
  });

  it('filters on every entity type the database can store, not a hand-kept subset', () => {
    for (const type of Object.values(AuditEntityType)) {
      expect(parseAuditEntityType(type)).toBe(type);
      expect(AUDIT_ENTITY_TYPES).toContain(type);
    }
    expect(parseAuditEntityType('PRIVACY_REQUEST')).toBe('PRIVACY_REQUEST');
    expect(parseAuditEntityType('COMPLIANCE_EVALUATION')).toBe('COMPLIANCE_EVALUATION');
    expect(parseAuditEntityType('INCIDENT')).toBe('INCIDENT');
    expect(parseAuditEntityType('ACCESS_REVIEW')).toBe('ACCESS_REVIEW');
    expect(parseAuditEntityType('RUNBOOK_EXECUTION')).toBe('RUNBOOK_EXECUTION');
  });

  it('ignores invalid URL values instead of passing them to Prisma', () => {
    expect(parseAuditEntityType('INTEGRATION')).toBeUndefined();
    expect(parseAuditEntityType('SETTING')).toBeUndefined();
    expect(parseAuditEntityType('not-an-enum')).toBeUndefined();
    expect(parseAuditEntityType()).toBeUndefined();
  });
});
