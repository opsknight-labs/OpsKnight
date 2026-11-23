import { describe, expect, it } from 'vitest';
import {
  buildRespondersView,
  deliveryState,
  describeEscalation,
  shortReason,
  type NotificationRow,
  type RespondersInput,
} from '@/lib/incidents/responders';

const NOW = new Date('2026-11-23T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function page(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    userId: 'u1',
    channel: 'EMAIL',
    status: 'SENT',
    recipientType: 'USER',
    recipientId: 'u1',
    recipientDisplay: 'm***@example.com',
    errorMsg: null,
    createdAt: minutesAgo(10),
    sentAt: minutesAgo(10),
    deliveredAt: null,
    failedAt: null,
    ackedAt: null,
    ackedVia: null,
    escalationStepIndex: 0,
    ...overrides,
  };
}

function input(overrides: Partial<RespondersInput> = {}): RespondersInput {
  return {
    now: NOW,
    incident: {
      status: 'OPEN',
      acknowledgedAt: null,
      acknowledgedById: null,
      acknowledgedVia: null,
      currentEscalationStep: null,
      nextEscalationAt: null,
      escalationStatus: null,
    },
    notifications: [],
    stepAttempts: [],
    people: [
      { id: 'u1', name: 'Maya Smith', avatarUrl: null, gender: null },
      { id: 'u2', name: 'Raj Patel', avatarUrl: null, gender: null },
      { id: 'u3', name: 'Ana Lee', avatarUrl: null, gender: null },
    ],
    roles: [],
    routing: { type: 'DEFAULT_POLICY', stepLabels: ['Primary On-Call', 'Maya Smith', 'Platform'] },
    onCall: null,
    ...overrides,
  };
}

describe('deliveryState / shortReason', () => {
  it('maps notification statuses', () => {
    expect(deliveryState('DELIVERED')).toBe('delivered');
    expect(deliveryState('PENDING')).toBe('pending');
    expect(deliveryState('FAILED')).toBe('failed');
    expect(deliveryState('SKIPPED')).toBe('skipped');
    expect(deliveryState('UNKNOWN')).toBe('unknown');
    expect(deliveryState('WHATEVER')).toBe('unknown');
  });

  it('keeps the first sentence, redacts contact details and clips', () => {
    expect(shortReason('API key is invalid')).toBe('API key is invalid');
    expect(
      shortReason('Twilio configuration incomplete. Please configure Account SID in Settings')
    ).toBe('Twilio configuration incomplete');
    expect(shortReason('Mailbox ops@example.com rejected')).toBe(
      'Mailbox [redacted email] rejected'
    );
    expect(shortReason('x'.repeat(200))).toHaveLength(60);
    expect(shortReason(null)).toBeNull();
  });
});

describe('buildRespondersView people', () => {
  it('groups pages by person with one chip per channel', () => {
    const view = buildRespondersView(
      input({
        notifications: [
          page({ channel: 'EMAIL' }),
          page({ channel: 'SMS', createdAt: minutesAgo(5) }),
          page({ userId: 'u2', recipientId: 'u2', escalationStepIndex: 1 }),
        ],
      })
    );
    expect(view.people.map(p => p.name)).toEqual(['Maya Smith', 'Raj Patel']);
    const maya = view.people[0];
    expect(maya.channels.map(c => c.label).sort()).toEqual(['Email', 'SMS']);
    expect(maya.firstPagedAgo).toBe('10m ago');
    expect(maya.via).toBe('Step 1 · Primary On-Call');
    expect(view.people[1].via).toBe('Step 2 · Maya Smith');
    expect(maya.summary).toBe('Not acknowledged');
    expect(maya.tone).toBe('elevated');
  });

  it('a delivered page on a channel beats an earlier failure; failures carry a short reason', () => {
    const view = buildRespondersView(
      input({
        notifications: [
          page({ status: 'FAILED', errorMsg: 'API key is invalid', failedAt: minutesAgo(9) }),
          page({ status: 'DELIVERED', deliveredAt: minutesAgo(4), createdAt: minutesAgo(5) }),
          page({ channel: 'SMS', status: 'FAILED', errorMsg: 'Number unreachable. Retry.' }),
        ],
      })
    );
    const [email, sms] = view.people[0].channels;
    expect(email).toMatchObject({ label: 'Email', state: 'delivered', tone: 'ok', reason: null });
    expect(sms).toMatchObject({ state: 'failed', tone: 'critical', reason: 'Number unreachable' });
    expect(view.people[0].summary).toBe('Delivered, not acknowledged');
  });

  it('marks a person whose every page failed as critical', () => {
    const view = buildRespondersView(
      input({ notifications: [page({ status: 'FAILED', errorMsg: 'API key is invalid' })] })
    );
    expect(view.people[0]).toMatchObject({ tone: 'critical', summary: 'Every page failed' });
  });

  it('matches the incident acknowledgement and sorts the acknowledger first', () => {
    const view = buildRespondersView(
      input({
        incident: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: minutesAgo(2),
          acknowledgedById: 'u2',
          acknowledgedVia: 'CHATOPS',
          currentEscalationStep: null,
          nextEscalationAt: null,
          escalationStatus: 'COMPLETED',
        },
        notifications: [page(), page({ userId: 'u2', createdAt: minutesAgo(1) })],
        roles: [{ roleKey: 'COMMANDER', userId: 'u2' }],
      })
    );
    expect(view.people[0]).toMatchObject({
      name: 'Raj Patel',
      role: 'Commander',
      tone: 'ok',
      summary: 'Acknowledged 2m ago via chat',
    });
    expect(view.people[1].ack).toBeNull();
  });

  it('uses a per-notification ack (voice key press) when the incident ack is not theirs', () => {
    const view = buildRespondersView(
      input({
        notifications: [page({ channel: 'VOICE', ackedAt: minutesAgo(3), ackedVia: 'VOICE' })],
      })
    );
    expect(view.people[0].summary).toBe('Acknowledged 3m ago via voice call');
  });

  it('lists an acknowledger who was never paged, and targeted people with no page', () => {
    const view = buildRespondersView(
      input({
        incident: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: minutesAgo(1),
          acknowledgedById: 'u3',
          acknowledgedVia: 'WEB',
          currentEscalationStep: null,
          nextEscalationAt: null,
          escalationStatus: null,
        },
        stepAttempts: [{ stepIndex: 2, resolvedUserIds: ['u2'], outcome: 'NOTIFIED' }],
      })
    );
    expect(view.people.map(p => [p.name, p.summary])).toEqual([
      ['Ana Lee', 'Acknowledged 1m ago via web'],
      ['Raj Patel', 'Targeted, no page recorded'],
    ]);
    expect(view.people[1].via).toBe('Step 3 · Platform');
  });

  it('keeps non-person destinations as their own rows', () => {
    const view = buildRespondersView(
      input({
        notifications: [
          page({
            userId: null,
            channel: 'SLACK',
            recipientType: 'SLACK_CHANNEL',
            recipientId: 'C1',
            recipientDisplay: '#incidents',
            escalationStepIndex: null,
          }),
        ],
      })
    );
    expect(view.people[0]).toMatchObject({ kind: 'destination', name: '#incidents', via: null });
  });
});

describe('describeEscalation', () => {
  const escalating = (overrides: Partial<RespondersInput['incident']> = {}) =>
    input({
      incident: {
        status: 'OPEN',
        acknowledgedAt: null,
        acknowledgedById: null,
        acknowledgedVia: null,
        currentEscalationStep: 1,
        nextEscalationAt: new Date(NOW.getTime() + 3 * 60_000),
        escalationStatus: 'ESCALATING',
        ...overrides,
      },
      stepAttempts: [{ stepIndex: 0, resolvedUserIds: ['u1'], outcome: 'NOTIFIED' }],
    });

  it('names the next step, its target and when', () => {
    expect(describeEscalation(escalating())).toEqual({
      tone: 'elevated',
      label: 'Escalating',
      progress: 'Step 1 of 3 paged',
      next: 'Next: step 2 → Maya Smith in 3m',
    });
    expect(describeEscalation(escalating({ nextEscalationAt: minutesAgo(1) })).next).toBe(
      'Next: step 2 → Maya Smith due now'
    );
  });

  it('explains why escalation is not moving', () => {
    expect(describeEscalation(escalating({ status: 'ACKNOWLEDGED' })).label).toBe(
      'Escalation stopped — acknowledged'
    );
    expect(describeEscalation(escalating({ status: 'RESOLVED' })).label).toBe(
      'Escalation stopped — resolved'
    );
    expect(describeEscalation(escalating({ status: 'SNOOZED' })).label).toBe('Paused — snoozed');
    expect(describeEscalation(escalating({ escalationStatus: 'PAUSED' })).label).toBe('Paused');
    expect(describeEscalation(escalating({ escalationStatus: 'COMPLETED' }))).toMatchObject({
      label: 'Max step reached — not acknowledged',
      tone: 'elevated',
    });
    expect(describeEscalation(escalating({ escalationStatus: 'FAILED' })).tone).toBe('critical');
    expect(
      describeEscalation(input({ routing: { type: 'NO_ESCALATION', stepLabels: [] } })).label
    ).toBe('No escalation for this incident');
    expect(describeEscalation(input({ routing: null })).label).toBe('No escalation policy');
  });
});

describe('on-call section', () => {
  it('is hidden without schedule read, and plain about missing or unreadable schedules', () => {
    expect(buildRespondersView(input()).onCall).toBeNull();
    expect(
      buildRespondersView(input({ onCall: { scheduleCount: 0, schedules: [] } })).onCall
    ).toEqual({ kind: 'no-schedule' });
    expect(
      buildRespondersView(input({ onCall: { scheduleCount: 2, schedules: [] } })).onCall
    ).toEqual({ kind: 'restricted' });
  });

  it('shows who is on now and next with shift edges', () => {
    const view = buildRespondersView(
      input({
        onCall: {
          scheduleCount: 1,
          schedules: [
            {
              scheduleId: 's1',
              scheduleName: 'Primary',
              onCall: [{ userId: 'u1', name: 'Maya Smith', end: '2026-11-23T17:00:00.000Z' }],
              next: { userId: 'u2', name: null, start: '2026-11-23T17:00:00.000Z' },
            },
          ],
        },
      })
    );
    expect(view.onCall).toEqual({
      kind: 'schedules',
      schedules: [
        {
          id: 's1',
          name: 'Primary',
          now: [
            {
              userId: 'u1',
              name: 'Maya Smith',
              until: '2026-11-23T17:00:00.000Z',
              endsIn: 'ends in 5h',
            },
          ],
          next: {
            userId: 'u2',
            name: 'Unknown user',
            start: '2026-11-23T17:00:00.000Z',
            startsIn: 'starts in 5h',
          },
        },
      ],
    });
  });
});
