import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('enterprise response-policy migration', () => {
  const sql = readFileSync(
    'prisma/migrations/20260909120000_enterprise_response_policy_control_plane/migration.sql',
    'utf8'
  );
  it('is additive, preserves legacy policy meaning and enforces bounded contracts', () => {
    expect(sql).toContain(`WHEN "priority" IS NULL THEN 'CLEAR'`);
    expect(sql).toContain(`"priorityMode" IN ('INHERIT', 'CLEAR')`);
    expect(sql).toContain(`"urgencyMode" IN ('INHERIT', 'DEFAULT')`);
    expect(sql).toContain(`"scopeKey" ~ '^integration:[A-Za-z0-9_-]+$'`);
    expect(sql).toContain('idx_incident_next_sla_transition');
    expect(sql).toContain(`"field" IN ('PRIORITY','URGENCY','SUPPORT_HOURS_STATE')`);
    expect(sql).not.toMatch(/UPDATE "Incident" SET/);
  });
});
