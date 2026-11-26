import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));
import {
  buildMicrosoftTeamsIncidentCard,
  RESOLUTION_NOTE_REGEX,
  teamsIncidentActivitySummary,
  type MicrosoftTeamsIncidentCardInput,
} from '@/lib/microsoft-teams/cards';
import {
  actorFromLifecycleMessage,
  escalationFromEventMessage,
} from '@/lib/microsoft-teams/card-actors';

type Incident = MicrosoftTeamsIncidentCardInput['incident'];
type Card = ReturnType<typeof buildMicrosoftTeamsIncidentCard>;

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'inc_123',
    title: 'Database latency spike',
    description: 'p99 latency exceeded 800ms on primary.',
    status: 'OPEN',
    urgency: 'HIGH',
    priority: 'P1',
    serviceName: 'payments-api',
    assigneeName: 'Alice',
    incidentUrl: 'https://opsknight.example.com/incidents/inc_123',
    createdAt: new Date('2026-09-12T00:00:00.000Z'),
    ...overrides,
  };
}

const header = (card: Card) => card.body[0] as { style: string };
const STATUS_LABELS = ['Triggered', 'Escalated', 'Acknowledged', 'Snoozed', 'Resolved'];
function statusTexts(card: Card): string[] {
  const found: string[] = [];
  JSON.stringify(card.body, (_key, value) => {
    if (
      (value?.type === 'TextBlock' || value?.type === 'TextRun') &&
      STATUS_LABELS.includes(String(value.text))
    )
      found.push(String(value.text));
    return value;
  });
  return found;
}
function badgeColor(card: Card): string | undefined {
  let color: string | undefined;
  JSON.stringify(card.body, (_key, value) => {
    if (value?.type === 'TextBlock' && STATUS_LABELS.includes(String(value.text)))
      color = value.color;
    return value;
  });
  return color;
}
const shared = { interactive: { destinationId: 'dest-1', messageGeneration: 2 } };

describe('Teams incident card states', () => {
  it.each([
    ['triggered', incident(), 'attention', 'Triggered', 'Attention'],
    [
      'acknowledged',
      incident({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }),
      'warning',
      'Acknowledged',
      'Warning',
    ],
    ['triggered', incident({ status: 'SNOOZED' }), 'warning', 'Snoozed', 'Warning'],
    [
      'resolved',
      incident({ status: 'RESOLVED', resolvedAt: new Date() }),
      'good',
      'Resolved',
      'Good',
    ],
    [
      'triggered',
      incident({ escalation: { level: 2, target: 'Bob' } }),
      'attention',
      'Escalated',
      'Attention',
    ],
  ] as const)(
    '%s / %s: header colour and the single badge agree',
    (eventType, inc, style, label, color) => {
      const card = buildMicrosoftTeamsIncidentCard({ incident: inc, eventType });
      expect(header(card).style).toBe(style);
      expect(statusTexts(card)).toEqual([label]);
      expect(badgeColor(card)).toBe(color);
      expect(JSON.stringify(card)).not.toContain('"title":"Status"');
    }
  );

  it('sets a meaningful activity summary and fallback text', () => {
    const input = { incident: incident(), eventType: 'triggered' as const };
    const card = buildMicrosoftTeamsIncidentCard(input);
    expect(teamsIncidentActivitySummary(input)).toBe('[P1] Triggered: Database latency spike');
    expect(card.fallbackText).toBe('[P1] Triggered: Database latency spike');
    expect(card._opsknightMeta.summary).toBe('[P1] Triggered: Database latency spike');
  });

  it('shows the escalation level and the person paged now as plain text', () => {
    const card = buildMicrosoftTeamsIncidentCard({
      incident: incident({ escalation: { level: 3, target: '[Bob](https://evil)' } }),
      eventType: 'triggered',
    });
    const json = JSON.stringify(card.body);
    expect(json).toContain(
      '"type":"TextRun","text":"Escalated to level 3 · paging [Bob](https://evil)"'
    );
  });

  it('fills acknowledged-by / resolved-by from actor data and roles from the incident', () => {
    const ack = buildMicrosoftTeamsIncidentCard({
      incident: incident({
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date('2026-09-12T00:05:00Z'),
        acknowledgedBy: 'Carol',
        roles: [{ shortLabel: 'IC', name: 'Dana' }],
      }),
      eventType: 'acknowledged',
    });
    const ackJson = JSON.stringify(ack.body);
    expect(ackJson).toContain('Acknowledged by Carol');
    expect(ackJson).toContain('IC: Dana');
    expect(ackJson).toContain('Acknowledged {{DATE(2026-09-12T00:05:00Z, SHORT)}}');
    const resolved = buildMicrosoftTeamsIncidentCard({
      incident: incident({ status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: 'Eve' }),
      eventType: 'resolved',
    });
    expect(JSON.stringify(resolved.body)).toContain('Resolved by Eve');
  });

  it('drops the empty spacer and the marketing footer', () => {
    const json = JSON.stringify(
      buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'triggered' })
    );
    expect(json).not.toContain('Open-source incident response');
    expect(json).not.toContain('"text":" "');
  });

  it('marks a re-posted card as a possible duplicate', () => {
    const json = JSON.stringify(
      buildMicrosoftTeamsIncidentCard({
        incident: incident({ repostNotice: true }),
        eventType: 'triggered',
      })
    );
    expect(json).toContain('An earlier copy of this card may exist');
  });
});

describe('Teams shared card actions', () => {
  it('shows Acknowledge and View on the posted (shared) triggered card, with refresh', () => {
    const card = buildMicrosoftTeamsIncidentCard(
      { incident: incident(), eventType: 'triggered' },
      shared
    );
    const actions = card.actions as Array<{ type: string; title: string; verb?: string }>;
    expect(actions.map(a => a.title)).toEqual(['Acknowledge', 'View Incident ↗']);
    expect(actions[0]).toMatchObject({ type: 'Action.Execute', verb: 'opsknight.incident.ack' });
    expect(card.refresh).toBeDefined();
    // Privileged extras stay behind the per-user refresh.
    expect(JSON.stringify(card)).not.toContain('opsknight.incident.escalate');
  });

  it('shows Resolve with a validated note on the shared acknowledged card', () => {
    const card = buildMicrosoftTeamsIncidentCard(
      {
        incident: incident({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }),
        eventType: 'acknowledged',
      },
      shared
    );
    const resolve = (card.actions as Array<Record<string, unknown>>).find(
      a => a.title === 'Resolve'
    ) as { card: { body: Array<Record<string, unknown>> } };
    expect(resolve).toBeDefined();
    expect(resolve.card.body[0]).toMatchObject({
      id: 'resolutionNote',
      maxLength: 1000,
      regex: RESOLUTION_NOTE_REGEX,
      errorMessage: expect.any(String),
    });
  });

  it('keeps a card without interactive context view-only (old installs)', () => {
    const card = buildMicrosoftTeamsIncidentCard({ incident: incident(), eventType: 'triggered' });
    expect((card.actions as unknown[]).length).toBe(1);
    expect(card.refresh).toBeUndefined();
  });

  it('resolution-note regex matches the server rule (blank, or 10–1000 trimmed chars)', () => {
    // eslint-disable-next-line security/detect-non-literal-regexp -- the exported card constant under test
    const re = new RegExp(RESOLUTION_NOTE_REGEX);
    expect(re.test('')).toBe(true);
    expect(re.test('   ')).toBe(true);
    expect(re.test('short')).toBe(false);
    expect(re.test('  0123456789  ')).toBe(true);
    expect(re.test('x'.repeat(1000))).toBe(true);
    expect(re.test('x'.repeat(1001))).toBe(false);
  });
});

describe('Teams card actor parsing', () => {
  it('reads actor names from lifecycle event messages', () => {
    expect(actorFromLifecycleMessage('Incident resolved by Alice Smith')).toBe('Alice Smith');
    expect(actorFromLifecycleMessage('Resolution note added by Bob')).toBe('Bob');
    expect(actorFromLifecycleMessage('Incident acknowledged by Carol via voice call')).toBe(
      'Carol'
    );
    expect(actorFromLifecycleMessage('Resolved: database failover done')).toBeNull();
  });

  it('reads escalation level and target from ESCALATED events', () => {
    expect(
      escalationFromEventMessage('Escalated to Bob Jones (Level 2, after 5 minute delay)')
    ).toEqual({ level: 2, target: 'Bob Jones' });
    expect(escalationFromEventMessage('Incident created')).toBeNull();
  });
});
