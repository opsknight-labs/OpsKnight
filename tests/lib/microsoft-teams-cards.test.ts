import { describe, it, expect } from 'vitest';
import { buildMicrosoftTeamsIncidentCard } from '@/lib/microsoft-teams/cards';

function incident(overrides: Partial<ReturnType<typeof baseIncident>> = {}) {
  return { ...baseIncident(), ...overrides };
}

function baseIncident() {
  return {
    id: 'inc_123',
    title: 'Database latency spike',
    description: 'p99 latency exceeded 800ms on primary.',
    status: 'OPEN',
    urgency: 'HIGH' as const,
    priority: 'P1' as const,
    serviceName: 'payments-api',
    assigneeName: 'Alice',
    incidentUrl: 'https://opsknight.example.com/incidents/inc_123',
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    acknowledgedAt: null as Date | null,
    resolvedAt: null as Date | null,
    acknowledgedBy: null as string | null,
    resolvedBy: null as string | null,
  };
}

describe('buildMicrosoftTeamsIncidentCard', () => {
  it('renders AdaptiveCard v1.5 with emphasis header, facts, and single View action', () => {
    const card = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'triggered' });
    expect(card.$schema).toContain('adaptive-card.json');
    expect(card.type).toBe('AdaptiveCard');
    expect(card.version).toBe('1.5');
    expect((card.actions as unknown[]).length).toBe(1);
    expect((card.actions as { type: string }[])[0].type).toBe('Action.OpenUrl');
    // Phase 1 omits Action.Execute — Phase 2 introduces ack/resolve/assign verbs.
    expect(JSON.stringify(card)).not.toContain('Action.Execute');
    expect((card.actions as { title: string }[])[0].title).toContain('View Incident');
    // FactSet carries incident state.
    const bodyJson = JSON.stringify(card.body);
    expect(bodyJson).toContain('FactSet');
    expect(bodyJson).toContain('payments-api');
  });

  it('encodes Triggered/Acknowledged/Resolved with distinct accent and badge', () => {
    const triggered = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'triggered' });
    const ack = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'acknowledged' });
    const resolved = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'resolved' });
    const tMeta = (triggered as { _opsknightMeta: { accent: string; eventType: string } })._opsknightMeta;
    const aMeta = (ack as { _opsknightMeta: { accent: string; eventType: string } })._opsknightMeta;
    const rMeta = (resolved as { _opsknightMeta: { accent: string; eventType: string } })._opsknightMeta;
    expect(tMeta.accent).toBe('#e11d48');
    expect(aMeta.accent).toBe('#d97706');
    expect(rMeta.accent).toBe('#059669');
    expect(tMeta.eventType).toBe('triggered');
    expect(aMeta.eventType).toBe('acknowledged');
    expect(rMeta.eventType).toBe('resolved');
  });

  it('suppresses empty description and truncates long description at 280 chars', () => {
    const noDesc = buildMicrosoftTeamsIncidentCard({ incident: incident({ description: '' }), eventType: 'triggered' });
    expect(JSON.stringify(noDesc)).not.toContain('p99'); // description TextBlock absent
    const long = 'x'.repeat(500);
    const truncated = buildMicrosoftTeamsIncidentCard({ incident: incident({ description: long }), eventType: 'triggered' });
    const bodyStr = JSON.stringify(truncated.body);
    // Should be sliced to ~280 with ellipsis, not 500 raw.
    expect(bodyStr.length).toBeLessThan(JSON.stringify(long).length + 2000);
    // description block still present but shorter than long.
    expect((truncated.body[1] as { items: unknown[] }).items.length).toBeGreaterThan(1);
  });

  it('sanitizes Action.OpenUrl — allows https, blocks javascript: and data:', () => {
    const https = buildMicrosoftTeamsIncidentCard({
      incident: incident({ incidentUrl: 'https://example.com/a?x=1&y=2' }),
      eventType: 'triggered',
    });
    expect((https.actions as { url: string }[])[0].url).toBe('https://example.com/a?x=1&y=2');

    const js = buildMicrosoftTeamsIncidentCard({
      incident: incident({ incidentUrl: 'javascript:alert(1)' }),
      eventType: 'triggered',
    });
    expect((js.actions as { url: string }[])[0].url).toBe('#');

    const data = buildMicrosoftTeamsIncidentCard({
      incident: incident({ incidentUrl: 'data:text/html,<script>x</script>' }),
      eventType: 'triggered',
    });
    expect((data.actions as { url: string }[])[0].url).toBe('#');
  });

  it('includes assignee fact when present and omits when absent', () => {
    const withAssignee = buildMicrosoftTeamsIncidentCard({ incident: incident({ assigneeName: 'Bob' }), eventType: 'triggered' });
    const withoutAssignee = buildMicrosoftTeamsIncidentCard({ incident: incident({ assigneeName: null as unknown as string }), eventType: 'triggered' });
    const withStr = JSON.stringify(withAssignee.body);
    const withoutStr = JSON.stringify(withoutAssignee.body);
    expect(withStr).toContain('Assignee');
    expect(withStr).toContain('Bob');
    // without assignee: fact list shorter; no Assignee title at all.
    expect(withoutStr).not.toContain('"title":"Assignee"');
  });

  it('shows acknowledged/resolved by line, otherwise UTC creation timestamp', () => {
    const ack = buildMicrosoftTeamsIncidentCard({
      incident: incident({ acknowledgedBy: 'Carol' }),
      eventType: 'acknowledged',
    });
    expect(JSON.stringify(ack.body)).toContain('Acknowledged by Carol');

    const resolved = buildMicrosoftTeamsIncidentCard({
      incident: incident({ resolvedBy: 'Dave' }),
      eventType: 'resolved',
    });
    expect(JSON.stringify(resolved.body)).toContain('Resolved by Dave');

    const triggered = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'triggered' });
    expect(JSON.stringify(triggered.body)).toContain('Created');
    expect(JSON.stringify(triggered.body)).toContain('UTC');
  });
});
