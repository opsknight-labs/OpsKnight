import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('enterprise response-policy migration', () => {
  const sql = readFileSync(
    'prisma/migrations/20260913120000_enterprise_response_policy_control_plane/migration.sql',
    'utf8'
  );
  it('is additive, preserves legacy policy meaning and enforces bounded contracts', () => {
    expect(sql).toContain(`policy."derivePriorityFromUrgency"`);
    expect(sql).toContain(`THEN 'INHERIT'`);
    expect(sql).toContain(`"priorityMode" IN ('INHERIT', 'CLEAR')`);
    expect(sql).toContain(`"urgencyMode" IN ('INHERIT', 'DEFAULT')`);
    expect(sql).toContain(`"scopeKey" ~ '^integration:[A-Za-z0-9_-]+$'`);
    expect(sql).not.toContain('CREATE INDEX "idx_incident_next_sla_transition"');
    expect(sql).toContain('incident_classification_rule_legacy_compat');
    expect(sql).toContain(`"field" IN ('PRIORITY','URGENCY','SUPPORT_HOURS_STATE')`);
    expect(sql).not.toMatch(/UPDATE "Incident" SET/);
  });
});
