import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  actor: vi.fn(),
  can: vi.fn(),
  authIncident: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
  slackCall: vi.fn(),
  card: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    serviceAutomationRule: { findMany: m.findMany, findFirst: m.findFirst },
    slackIncidentMessage: { findFirst: m.card },
  },
}));
vi.mock('@/lib/authorization-actors', () => ({ resolveUserActor: m.actor }));
vi.mock('@/lib/authorization-policy', () => ({ actorHasCapability: m.can }));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({ authorizeChatOpsIncident: m.authIncident }));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: m.preview,
  startRunbookExecution: m.start,
}));
vi.mock('@/lib/slack/api', () => ({ callSlackApi: m.slackCall }));
vi.mock('@/lib/slack', () => ({ getSlackBotToken: vi.fn().mockResolvedValue('xoxb') }));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://x.test' }));
vi.mock('@/lib/errors', async importOriginal => ({
  ...(await importOriginal<object>()),
  toPublicAppError: (e: Error) => ({ message: e.message }),
}));

import { handleRunbookButton, listIncidentRunbooks } from '@/lib/slack/runbook-flow';

const digest = 'a'.repeat(64);
const token = 'b'.repeat(64);
const binding = {
  name: 'x',
  id: 'bd1',
  runbookId: 'rb1',
  serviceId: 's1',
  versionStrategy: 'LATEST_PUBLISHED',
  runbookVersionId: null,
  runbook: { name: 'Restart', publishedVersionId: 'v1' },
};
const click = (actionType: string, value: Record<string, unknown> = {}) =>
  handleRunbookButton({
    actionType,
    value: { bindingId: 'bd1', ...value },
    incidentId: 'i1',
    actor: { id: 'u1', name: 'Ann' },
    serviceId: 's1',
    slackUserId: 'U1',
  });
const plan = (over = {}) => ({
  digest,
  authorizationToken: token,
  version: 2,
  steps: [{ name: 'Restart', type: 'HTTP', risk: 'LOW', requiresApproval: false }],
  readiness: [{ state: 'passed', message: 'ok' }],
  ...over,
});

describe('runbook flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.actor.mockResolvedValue({ id: 'u1' });
    m.can.mockReturnValue(true);
    m.findFirst.mockResolvedValue(binding);
    m.preview.mockResolvedValue(plan());
    m.start.mockResolvedValue({ id: 'ex1' });
    m.card.mockResolvedValue({ channelId: 'C1', ts: '1.2' });
  });

  it('lists at most 5 runbooks with a Preview button each', async () => {
    m.findMany.mockResolvedValue([{ id: 'bd1', runbook: { name: 'Restart' } }]);
    const res = await listIncidentRunbooks('i1', 'u1');
    expect(m.findMany.mock.calls[0][0].take).toBe(5);
    expect(JSON.stringify(res.blocks)).toContain('rb_preview');
    expect(m.start).not.toHaveBeenCalled();
  });

  it('preview offers confirm with digest and token but never starts', async () => {
    const res = await click('rb_preview');
    const json = JSON.stringify(res.blocks);
    expect(json).toContain('Confirm and run');
    expect(json).toContain(digest);
    expect(m.start).not.toHaveBeenCalled();
  });

  it('preview with a blocked readiness has no confirm button', async () => {
    m.preview.mockResolvedValue(plan({ readiness: [{ state: 'blocked', message: 'no agent' }] }));
    expect(JSON.stringify((await click('rb_preview')).blocks)).not.toContain('Confirm and run');
  });

  it('approval-needing plans say the run waits for an approver', async () => {
    m.preview.mockResolvedValue(
      plan({ steps: [{ name: 'Drop', type: 'SQL', risk: 'HIGH', requiresApproval: true }] })
    );
    expect(JSON.stringify((await click('rb_preview')).blocks)).toContain('need approval');
  });

  it('refuses a user without runbook.execute', async () => {
    m.can.mockReturnValue(false);
    const res = await click('rb_preview');
    expect(res.text).toContain('permission');
    expect(m.preview).not.toHaveBeenCalled();
  });

  it('confirm starts once with the previewed digest and token, then posts the thread reply', async () => {
    const res = await click('rb_run', { digest, token });
    expect(m.start).toHaveBeenCalledTimes(1);
    expect(m.start.mock.calls[0][0]).toMatchObject({
      triggeredByUserId: 'u1',
      expectedPlanDigest: digest,
      previewAuthorizationToken: token,
    });
    expect(res.response_type).toBe('in_channel');
    expect(m.slackCall).toHaveBeenCalledWith(
      'chat.postMessage',
      'xoxb',
      expect.objectContaining({ thread_ts: '1.2' })
    );
  });

  it('a stale digest or reused token is refused ephemerally (double click safe)', async () => {
    m.start.mockRejectedValue(new Error('PREVIEW_AUTHORIZATION_INVALID: used'));
    const res = await click('rb_run', { digest, token });
    expect(res.response_type).toBe('ephemeral');
    expect(res.replace_original).toBe(false);
    expect(m.slackCall).not.toHaveBeenCalled();
  });

  it('rejects malformed confirm values without calling the orchestrator', async () => {
    const res = await click('rb_run', { digest: 'x', token });
    expect(res.response_type).toBe('ephemeral');
    expect(m.start).not.toHaveBeenCalled();
  });
});
