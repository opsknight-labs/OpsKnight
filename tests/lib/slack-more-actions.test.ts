import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  enqueue: vi.fn(),
  assign: vi.fn(),
  join: vi.fn(),
  findIncident: vi.fn(),
  resolveUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { incident: { findUnique: h.findIncident } } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: h.enqueue }));
vi.mock('@/lib/chatops/slash-commands', () => ({
  workspaceBotToken: vi.fn().mockResolvedValue('xoxb-test'),
  resolveOpsKnightUser: h.resolveUser,
}));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  executeChatOpsAssignment: h.assign,
  executeChatOpsJoinResponder: h.join,
  executeChatOpsNote: vi.fn(),
  chatOpsLifecycleErrorMessage: (error: Error) => error.message,
}));

import {
  acceptIncidentModalSubmission,
  handleIncidentModalSubmission,
  openIncidentActionModal,
  parseIncidentModalSubmission,
} from '@/lib/chatops/slack-incident-modals';
import { SLACK_MORE_ACTIONS_ACTION_ID, moreActionsOverflow } from '@/lib/chatops/slack-action-map';
import { buildIncidentCard, type SlackBlock } from '@/lib/slack/incident-card';
import { renderSlackWarRoomProjection } from '@/lib/war-room/providers/slack/render';
import { buildWarRoomProjection } from '@/lib/war-room/projection-model';

const incident = {
  id: 'inc-1',
  title: 'Checkout latency',
  status: 'OPEN' as const,
  urgency: 'HIGH' as const,
  priority: 'P1',
  serviceName: 'payments',
  url: 'https://ops.example.com/incidents/inc-1',
  createdAt: new Date('2026-11-01T10:00:00Z'),
};

const overflowOf = (elements: SlackBlock[] | undefined) =>
  elements?.find(e => e.action_id === SLACK_MORE_ACTIONS_ACTION_ID);

describe('More actions overflow', () => {
  it('carries parseable values within Slack limits', () => {
    const menu = moreActionsOverflow('inc-1');
    expect(menu.options.map(o => JSON.parse(o.value))).toEqual([
      { action: 'add_responder', incidentId: 'inc-1' },
      { action: 'reassign', incidentId: 'inc-1' },
      { action: 'update_details', incidentId: 'inc-1' },
      { action: 'status_update', incidentId: 'inc-1' },
    ]);
    expect(menu.options.every(o => o.value.length <= 150)).toBe(true);
  });

  it('is on the channel card while open and gone once resolved', () => {
    const elementsFor = (status: string) =>
      buildIncidentCard({ ...incident, status } as never, {
        appUrl: 'https://ops.example.com',
        interactive: true,
      }).attachments[0].blocks.find(b => b.type === 'actions')?.elements as SlackBlock[];
    expect(overflowOf(elementsFor('OPEN'))).toBeDefined();
    expect(elementsFor('OPEN').length).toBeLessThanOrEqual(25);
    expect(overflowOf(elementsFor('RESOLVED'))).toBeUndefined();
  });

  it('is on the war-room card while open and gone once resolved', () => {
    const elementsFor = (status: string) =>
      renderSlackWarRoomProjection(
        buildWarRoomProjection({ ...incident, status } as never)
      ).blocks.find((b: { type: string }) => b.type === 'actions')?.elements as
        SlackBlock[] | undefined;
    expect(overflowOf(elementsFor('OPEN'))).toBeDefined();
    expect(elementsFor('RESOLVED')).toBeUndefined();
  });
});

describe('incident action modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) }));
  });

  const click = (value: string, extra: Record<string, unknown> = {}) => ({
    team: { id: 'T1' },
    trigger_id: 'trig',
    response_url: 'https://hooks.slack.com/actions/x',
    channel: { id: 'C1' },
    container: { message_ts: '1.2' },
    actions: [{ action_id: SLACK_MORE_ACTIONS_ACTION_ID, selected_option: { value } }],
    ...extra,
  });

  it('opens the modal from an overflow selection without a button value or any database work', async () => {
    const response = await openIncidentActionModal(
      click(JSON.stringify({ action: 'reassign', incidentId: 'inc-1' }))
    );
    expect(response.status).toBe(200);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body.trigger_id).toBe('trig');
    expect(body.view.callback_id).toBe('opsknight_incident_reassign');
    expect(JSON.parse(body.view.private_metadata)).toMatchObject({
      incidentId: 'inc-1',
      channelId: 'C1',
      messageTs: '1.2',
    });
    expect(h.findIncident).not.toHaveBeenCalled();
  });

  it('refuses a malformed selection privately without opening anything', async () => {
    const response = await openIncidentActionModal(click('not json'));
    expect(await response.json()).toMatchObject({
      response_type: 'ephemeral',
      replace_original: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates the submission and queues it only when a person is picked', async () => {
    const view = (
      values: unknown,
      meta = JSON.stringify({ incidentId: 'inc-1', channelId: 'C1' })
    ) => ({
      team: { id: 'T1' },
      user: { id: 'U111' },
      view: { state: { values }, private_metadata: meta },
    });
    expect(parseIncidentModalSubmission({}).ok).toBe(false);
    const invalid = await acceptIncidentModalSubmission('reassign', view({}), 'sig');
    expect(await invalid.json()).toMatchObject({ response_action: 'errors' });
    expect(h.enqueue).not.toHaveBeenCalled();

    const ok = await acceptIncidentModalSubmission(
      'add_responder',
      view({
        modal_person: { value: { selected_user: 'U222' } },
        modal_note: { value: { value: 'help' } },
      }),
      'sig'
    );
    expect(ok.status).toBe(200);
    expect(h.enqueue.mock.calls[0][0].payload).toMatchObject({
      __kind: 'INCIDENT_MODAL_SUBMISSION',
      action: 'add_responder',
      incidentId: 'inc-1',
      personSlackId: 'U222',
      note: 'help',
      user_id: 'U111',
    });
  });

  describe('worker', () => {
    const queued = {
      __kind: 'INCIDENT_MODAL_SUBMISSION' as const,
      action: 'reassign' as const,
      incidentId: 'inc-1',
      personSlackId: 'U222',
      team_id: 'T1',
      user_id: 'U111',
    };
    beforeEach(() => {
      h.findIncident.mockResolvedValue({
        slackWorkspaceId: 'T1',
        service: { slackWorkspaceId: null, slackIntegration: null },
      });
      h.resolveUser.mockImplementation(async (slackId: string) =>
        slackId === 'U111'
          ? { id: 'u-actor', name: 'Ana' }
          : slackId === 'U222'
            ? { id: 'u-bob', name: 'Bob' }
            : null
      );
      h.assign.mockResolvedValue({ changed: true });
    });

    it('reassigns as the clicker with the normal command', async () => {
      const reply = await handleIncidentModalSubmission(queued);
      expect(h.assign).toHaveBeenCalledWith(
        expect.objectContaining({ actor: { id: 'u-actor', name: 'Ana' }, targetUserId: 'u-bob' })
      );
      expect(reply).toMatchObject({ response_type: 'ephemeral', replace_original: false });
      expect(reply.text).toContain('Bob');
    });

    it('refuses an unlinked person and a permission failure privately', async () => {
      const unlinked = await handleIncidentModalSubmission({ ...queued, personSlackId: 'U999' });
      expect(unlinked.text).toContain('not linked');
      expect(h.assign).not.toHaveBeenCalled();
      h.assign.mockRejectedValueOnce(new Error('You cannot manage this incident.'));
      const denied = await handleIncidentModalSubmission(queued);
      expect(denied).toMatchObject({ replace_original: false });
      expect(denied.text).toContain('cannot manage');
    });

    it('rejects an incident from another workspace', async () => {
      h.findIncident.mockResolvedValue({
        slackWorkspaceId: 'T2',
        service: { slackWorkspaceId: null, slackIntegration: null },
      });
      expect((await handleIncidentModalSubmission(queued)).text).toContain('not found');
      expect(h.assign).not.toHaveBeenCalled();
    });
  });
});
