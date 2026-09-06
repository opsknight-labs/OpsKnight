import { describe, expect, it } from 'vitest';
import { AUDIT_ENTITY_TYPES, parseAuditEntityType } from '@/lib/audit-filters';

describe('audit entity filters', () => {
  it('accepts only entity types that Prisma can query', () => {
    expect(parseAuditEntityType('SYSTEM_CONFIG')).toBe('SYSTEM_CONFIG');
    expect(parseAuditEntityType('TEAM_MEMBER')).toBe('TEAM_MEMBER');
    expect(AUDIT_ENTITY_TYPES).toContain('SCHEDULE');
  });

  it('ignores invalid URL values instead of passing them to Prisma', () => {
    expect(parseAuditEntityType('INTEGRATION')).toBeUndefined();
    expect(parseAuditEntityType('SETTING')).toBeUndefined();
    expect(parseAuditEntityType('not-an-enum')).toBeUndefined();
    expect(parseAuditEntityType()).toBeUndefined();
  });
});
