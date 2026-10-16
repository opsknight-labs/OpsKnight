import { describe, expect, it } from 'vitest';
import {
  describeCondition,
  formatDuration,
  readinessFixHint,
  ruleInputRows,
  ruleStatusKind,
  successRate,
} from '@/components/service/automation-rule/rule-presentation';

describe('automation rule presentation', () => {
  it('renders conditions as readable chips with redacted values', () => {
    expect(
      describeCondition({ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' })
    ).toBe('Incident urgency = HIGH');
    expect(describeCondition({ field: 'priority', operator: 'IN', value: ['P1', 'P2'] })).toBe(
      'Incident priority is one of P1, P2'
    );
    expect(describeCondition({ field: 'incident.tags', operator: 'EXISTS', value: null })).toBe(
      'Incident tags exists'
    );
    expect(
      describeCondition({
        field: 'incident.title',
        operator: 'CONTAINS',
        value: 'secret://abc-123',
      })
    ).not.toContain('secret://');
  });

  it('derives the status kind with archive and pause taking precedence', () => {
    expect(ruleStatusKind({ mode: 'AUTOMATIC', enabled: true, detachedAt: null })).toBe(
      'AUTOMATIC'
    );
    expect(ruleStatusKind({ mode: 'AUTOMATIC', enabled: false, detachedAt: null })).toBe('PAUSED');
    expect(ruleStatusKind({ mode: 'SUGGESTED', enabled: false, detachedAt: new Date() })).toBe(
      'ARCHIVED'
    );
  });

  it('offers fix hints for actionable readiness codes only', () => {
    expect(readinessFixHint('NO_TRIGGER', 'svc', 'rb')?.href).toBe('/services/svc?tab=runbooks');
    expect(readinessFixHint('AGENT_POLICY_agent1', 'svc', 'rb')?.href).toBe(
      '/runbooks/agents?agentId=agent1'
    );
    expect(readinessFixHint('APPROVAL_REQUIRED', 'svc', 'rb')).toBeNull();
  });

  it('formats durations and success rate over finished runs', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(formatDuration(start, new Date('2026-01-01T00:00:42Z'), 'SUCCEEDED')).toBe('42s');
    expect(formatDuration(start, new Date('2026-01-01T00:02:05Z'), 'SUCCEEDED')).toBe('2m 5s');
    expect(formatDuration(start, null, 'RUNNING')).toBe('In progress');
    expect(formatDuration(null, null, 'QUEUED')).toBe('—');
    expect(
      successRate([
        { status: 'SUCCEEDED' },
        { status: 'FAILED' },
        { status: 'RUNNING' },
        { status: 'SUCCEEDED' },
        { status: 'SUCCEEDED' },
      ])
    ).toBe(75);
    expect(successRate([{ status: 'QUEUED' }])).toBeNull();
  });

  it('masks secret references and sensitive keys in input rows', () => {
    const rows = ruleInputRows(
      [
        { key: 'credential', label: 'Credential', type: 'SECRET_REF', defaultValue: 'secret://x' },
        { key: 'host', label: 'Host', type: 'STRING', defaultValue: null },
        { key: 'unset', label: 'Unset', type: 'STRING', defaultValue: null },
      ],
      { host: 'db-1', api_token: 'raw-value' }
    );
    expect(rows).toEqual([
      {
        key: 'credential',
        label: 'Credential',
        secret: true,
        value: 'Configured secret reference',
      },
      { key: 'host', label: 'Host', secret: false, value: 'db-1' },
      { key: 'unset', label: 'Unset', secret: false, value: 'Not set' },
      { key: 'api_token', label: 'api_token', secret: false, value: '[REDACTED]' },
    ]);
  });
});
