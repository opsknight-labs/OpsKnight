/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  prisma: { service: { findMany: vi.fn() }, incident: { findUnique: vi.fn() } },
  callSlackApi: vi.fn(),
  enqueue: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: m.prisma }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: m.callSlackApi }));
vi.mock('@/lib/chatops/intents', () => ({ enqueueChatOpsIntent: m.enqueue }));
vi.mock('@/lib/chatops/slash-commands', () => ({
  workspaceBotToken: vi.fn().mockResolvedValue('xoxb'),
  buildSlackDeclareModal: (i: { channelId?: string }) => ({
    type: 'modal',
    private_metadata: JSON.stringify({ channelId: i.channelId }),
    blocks: [
      { block_id: 'declare_title', element: {} },
      { block_id: 'declare_description', element: {} },
    ],
  }),
  openSlackDeclareModal: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({
  authorizeChatOpsIncident: vi.fn(),
  chatOpsLifecycleErrorMessage: () => 'x',
}));

import { handleSlackShortcut, prefillFromMessage, SLACK_SHORTCUTS } from '@/lib/slack/shortcuts';
import {
  buildSlackStatusModal,
  buildSlackUpdateModal,
  buildUpdateOverflowOptions,
  handleSlackOpsInteractive,
  parseStatusSubmission,
  parseUpdateSubmission,
  SLACK_UPDATE_CALLBACK_ID,
} from '@/lib/slack/update-actions';

const view = (values: Record<string, unknown>): any => ({ state: { values } });
const input = (block: string, value: string) => ({ [block]: { value: { value } } });
const select = (block: string, value: string) => ({
  [block]: { value: { selected_option: { value } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.service.findMany.mockResolvedValue([{ id: 's1', name: 'API' }]);
  m.callSlackApi.mockResolvedValue({ ok: true, data: { permalink: 'https://x.slack.com/p1' } });
});

describe('modals', () => {
  const incident = {
    id: 'i1',
    title: 'API down',
    description: 'desc',
    priority: 'P2',
    urgency: 'HIGH',
  };
  it('prefills the update modal from the incident', () => {
    const modal = buildSlackUpdateModal(incident, 'https://hooks.slack.com/r');
    const title = modal.blocks.find(b => b.block_id === 'update_title') as any;
    const priority = modal.blocks.find(b => b.block_id === 'update_priority') as any;
    expect(title.element.initial_value).toBe('API down');
    expect(priority.element.initial_option.value).toBe('P2');
    expect(JSON.parse(modal.private_metadata)).toMatchObject({ incidentId: 'i1' });
    expect(buildSlackStatusModal(incident).callback_id).toBe('opsknight_incident_status');
  });
  it('overflow option values fit Slack limits', () => {
    const options = buildUpdateOverflowOptions('c'.repeat(25));
    expect(options.map(o => o.text.text)).toEqual(['Update details', 'Post status update']);
    for (const option of options) expect(option.value.length).toBeLessThanOrEqual(75);
  });
});

describe('submission validation', () => {
  it('accepts a valid update and drops an empty description', () => {
    const parsed = parseUpdateSubmission(
      view({ ...input('update_title', 'New title'), ...select('update_urgency', 'LOW') })
    );
    expect(parsed).toEqual({ ok: true, changes: { title: 'New title', urgency: 'LOW' } });
  });
  it('reports errors by block id', () => {
    const parsed = parseUpdateSubmission(view({ ...input('update_title', 'x') }));
    expect(parsed).toMatchObject({ ok: false });
    expect((parsed as { errors: Record<string, string> }).errors).toHaveProperty('update_title');
    expect((parsed as { errors: Record<string, string> }).errors).toHaveProperty('update_urgency');
  });
  it('validates the status message and notify box', () => {
    expect(parseStatusSubmission(view({}))).toMatchObject({ ok: false });
    const ok = parseStatusSubmission(
      view({
        ...input('status_message', 'We are investigating'),
        status_notify: { value: { selected_options: [{ value: 'notify' }] } },
      })
    );
    expect(ok).toEqual({ ok: true, message: 'We are investigating', notify: true });
  });
  it('queues a valid submission and returns inline errors for an invalid one', async () => {
    const payload = {
      type: 'view_submission',
      team: { id: 'T1' },
      user: { id: 'U1' },
      view: {
        callback_id: SLACK_UPDATE_CALLBACK_ID,
        private_metadata: JSON.stringify({ incidentId: 'i1' }),
        state: view({ ...input('update_title', 'New title'), ...select('update_urgency', 'LOW') })
          .state,
      },
    };
    const ok = await handleSlackOpsInteractive(payload as any, 'sig');
    expect(ok?.status).toBe(200);
    expect(m.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          __kind: 'INCIDENT_UPDATE_SUBMISSION',
          op: 'details',
          incidentId: 'i1',
        }),
      })
    );
    m.enqueue.mockClear();
    const bad = await handleSlackOpsInteractive(
      { ...payload, view: { ...payload.view, state: {} } },
      'sig'
    );
    expect(await bad?.json()).toMatchObject({ response_action: 'errors' });
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it('ignores unrelated interactions', async () => {
    expect(
      await handleSlackOpsInteractive(
        { type: 'block_actions', actions: [{ value: '{"action":"ack","incidentId":"i"}' }] },
        's'
      )
    ).toBeNull();
    expect(
      await handleSlackOpsInteractive(
        { type: 'block_actions', actions: [{ value: 'not json' }] },
        's'
      )
    ).toBeNull();
  });
});

describe('shortcuts', () => {
  it('lists both shortcuts for the manifest', () => {
    expect(SLACK_SHORTCUTS.map(s => s.callback_id)).toEqual([
      'declare_from_message',
      'declare_incident',
    ]);
  });
  it('prefills title (first line, 200) and description with a permalink', () => {
    const { title, description } = prefillFromMessage(`\n${'a'.repeat(300)}\nsecond`, 'https://p');
    expect(title).toHaveLength(200);
    expect(description).toContain('Source: https://p');
  });
  it('opens the modal with the trigger_id and a prefilled view for a message action', async () => {
    const res = await handleSlackShortcut({
      type: 'message_action',
      callback_id: 'declare_from_message',
      trigger_id: 'trig',
      team: { id: 'T1' },
      channel: { id: 'C1' },
      message: { text: 'Checkout is failing\nsince 10:00', ts: '1.2' },
    });
    expect(res.status).toBe(200);
    const open = m.callSlackApi.mock.calls.find(c => c[0] === 'views.open')!;
    expect(open[2].trigger_id).toBe('trig');
    const blocks = open[2].view.blocks;
    expect(blocks[0].element.initial_value).toBe('Checkout is failing');
    expect(blocks[1].element.initial_value).toContain('https://x.slack.com/p1');
    expect(JSON.parse(open[2].view.private_metadata)).toMatchObject({
      channelId: 'C1',
      sourceTs: '1.2',
    });
  });
  it('opens an unprefilled modal for the global shortcut', async () => {
    await handleSlackShortcut({
      type: 'shortcut',
      callback_id: 'declare_incident',
      trigger_id: 't',
      team: { id: 'T1' },
    });
    const open = m.callSlackApi.mock.calls.find(c => c[0] === 'views.open')!;
    expect(open[2].view.blocks[0].element.initial_value).toBeUndefined();
  });
  it('is safe on malformed payloads and Slack failures', async () => {
    expect((await handleSlackShortcut({})).status).toBe(200);
    expect(
      (await handleSlackShortcut({ type: 'shortcut', callback_id: 'declare_incident' })).status
    ).toBe(200);
    expect(m.callSlackApi).not.toHaveBeenCalled();
    m.callSlackApi.mockResolvedValue({ ok: false, error: 'expired_trigger_id' });
    const res = await handleSlackShortcut({
      type: 'shortcut',
      callback_id: 'declare_incident',
      trigger_id: 't',
      team: { id: 'T1' },
    });
    expect(res.status).toBe(200);
  });
});
