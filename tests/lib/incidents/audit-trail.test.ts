import { describe, expect, it } from 'vitest';
import {
  countAuditKinds,
  describeAuditChanges,
  groupAuditTrail,
  humanizeAuditAction,
  toAuditTrailRow,
  type AuditRowInput,
} from '@/lib/incidents/audit-trail';

let seq = 0;
const row = (over: Partial<AuditRowInput> = {}): AuditRowInput => ({
  id: `a${++seq}`,
  action: 'incident.acknowledged',
  createdAt: new Date(Date.UTC(2026, 10, 24, 10, 0, 60 - seq)),
  actorId: null,
  actorName: null,
  actorEmail: null,
  channel: null,
  details: null,
  ...over,
});

describe('toAuditTrailRow', () => {
  it('classifies a person acting in the web app', () => {
    const view = toAuditTrailRow(
      row({
        action: 'incident.reassigned',
        actorId: 'u1',
        actorName: 'Ada',
        details: {
          source: 'UI',
          actor: { type: 'USER' },
          oldValue: null,
          newValue: { teamId: null, assigneeId: 'u2' },
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'person',
      actor: 'Ada',
      source: 'Web',
      summary: 'Reassigned · assignee set',
    });
  });

  it('classifies MCP and REST v2 changes as API/MCP', () => {
    expect(
      toAuditTrailRow(row({ actorId: 'u1', channel: 'mcp:client-1', details: { source: 'API' } }))
    ).toMatchObject({ kind: 'api', source: 'MCP' });
    expect(
      toAuditTrailRow(
        row({
          actorId: 'u1',
          details: { source: 'UI', metadata: { apiGateway: 'api_v2', apiClientId: 'k1' } },
        })
      )
    ).toMatchObject({ kind: 'api', source: 'Web' });
  });

  it('classifies Squire actions as AI with the outcome', () => {
    const view = toAuditTrailRow(
      row({
        action: 'intelligence.squire.action',
        actorId: 'u1',
        actorName: 'Ada',
        details: {
          source: 'INTEGRATION',
          metadata: { squireAction: 'acknowledge', outcome: 'FAILED', channel: 'slack' },
        },
      })
    );
    expect(view).toMatchObject({
      kind: 'ai',
      summary: 'Ran acknowledge (failed)',
      source: 'Slack',
    });
  });

  it('classifies actorless rows as automation named System', () => {
    const view = toAuditTrailRow(
      row({ action: 'microsoftTeams.delivery.failed', details: { source: 'INTEGRATION' } })
    );
    expect(view).toMatchObject({
      kind: 'automation',
      actor: 'System',
      source: 'Teams',
      summary: 'Microsoft teams delivery failed',
    });
  });
});

describe('describeAuditChanges', () => {
  it('shows short values, hides ids and redacted values, caps at three', () => {
    expect(
      describeAuditChanges(
        { status: 'OPEN', userId: 'u1', roleKey: '[REDACTED]' },
        { status: 'ACKNOWLEDGED', userId: null, roleKey: '[REDACTED]' }
      )
    ).toEqual(['status OPEN → ACKNOWLEDGED', 'user cleared']);
    expect(describeAuditChanges({}, { a: 1, b: 2, c: 3, d: 4, e: 5 })).toEqual([
      'a 1',
      'b 2',
      'c 3',
      '+2 more',
    ]);
  });

  it('humanizes dotted, snake and camel actions', () => {
    expect(humanizeAuditAction('incident.role_assigned')).toBe('Role assigned');
    expect(humanizeAuditAction('INCIDENT_WAR_ROOM_RECONCILIATION_REQUESTED')).toBe(
      'War room reconciliation requested'
    );
  });
});

describe('groupAuditTrail', () => {
  it('folds consecutive identical automated rows but never people', () => {
    const auto = () => toAuditTrailRow(row({ action: 'escalation.step_executed' }));
    const person = () => toAuditTrailRow(row({ actorId: 'u1', actorName: 'Ada' }));
    const rows = [auto(), auto(), auto(), person(), person(), auto()];
    const groups = groupAuditTrail(rows);
    expect(groups.map(g => [g.kind, g.count])).toEqual([
      ['automation', 3],
      ['person', 1],
      ['person', 1],
      ['automation', 1],
    ]);
    expect(groups[0].at).toBe(rows[0].at);
    expect(groups[0].firstAt).toBe(rows[2].at);
    expect(countAuditKinds(rows)).toEqual({ all: 6, person: 2, automation: 4, ai: 0, api: 0 });
  });
});
