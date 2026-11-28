import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  pmCommand: vi.fn(),
  pmFind: vi.fn(),
  getItems: vi.fn(),
  replace: vi.fn(),
  update: vi.fn(),
  resolveActor: vi.fn(),
  itemFindMany: vi.fn(),
  itemCount: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    postmortem: { findUnique: m.pmFind },
    actionItem: { findMany: m.itemFindMany, count: m.itemCount },
  },
}));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: (fn: (tx: unknown) => unknown) =>
    fn({ actionItem: { update: m.update } }),
}));
vi.mock('@/lib/authorization-actors', () => ({ resolveUserActor: m.resolveActor }));
vi.mock('@/lib/incidents/chatops-lifecycle', () => ({ authorizeChatOpsIncident: vi.fn() }));
vi.mock('@/lib/incidents/chatops-postmortem', () => ({
  executeChatOpsPostmortemCommand: m.pmCommand,
}));
vi.mock('@/lib/postmortems/authorization', () => ({
  assertPostmortemAccess: vi.fn(),
  postmortemEditWhere: vi.fn(),
}));
vi.mock('@/lib/postmortems/action-item-commands', () => ({
  getPostmortemActionItems: m.getItems,
  replacePostmortemActionItems: m.replace,
}));
vi.mock('@/lib/env-validation', () => ({ getBaseUrl: () => 'https://x.test' }));

import {
  handleActionCommand,
  handleActionsListCommand,
  parseActionArgs,
} from '@/lib/chatops/slash/action-command';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const now = new Date('2026-12-01T12:00:00Z');

describe('parseActionArgs', () => {
  it('parses mention and due date', () => {
    expect(parseActionArgs('Fix the cache <@U123|bob> due:2026-12-10', now)).toEqual({
      ok: true,
      title: 'Fix the cache',
      ownerSlackId: 'U123',
      dueDate: '2026-12-10',
    });
  });
  it('rejects bad, impossible and past dates, but allows yesterday', () => {
    expect(parseActionArgs('x due:12/10', now).ok).toBe(false);
    expect(parseActionArgs('x due:2026-02-30', now).ok).toBe(false);
    expect(parseActionArgs('x due:2026-11-01', now).ok).toBe(false);
    expect(parseActionArgs('x due:2026-12-01', now).ok).toBe(true);
  });
  it('rejects empty, long and multi-owner input', () => {
    expect(parseActionArgs('<@U1>', now).ok).toBe(false);
    expect(parseActionArgs('a'.repeat(201), now).ok).toBe(false);
    expect(parseActionArgs('x <@U1> <@U2>', now).ok).toBe(false);
  });
});

describe('handleActionCommand', () => {
  const base = {
    incident: { id: 'i1', title: 'T' },
    actor: { id: 'u1', name: 'Ann' },
    channelName: 'inc',
    now,
    resolveOwner: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    m.resolveActor.mockResolvedValue({ id: 'u1' });
    m.pmCommand.mockResolvedValue({ created: false });
    m.pmFind.mockResolvedValue({ id: 'pm1' });
    m.getItems.mockResolvedValue({
      revision: 3,
      items: [{ id: 'a', title: 'old', status: 'OPEN', priority: 'LOW' }],
    });
    m.replace.mockResolvedValue({ items: [{ id: 'a' }, { id: 'new' }] });
  });

  it('reuses the draft postmortem, appends and marks the row MANUAL', async () => {
    base.resolveOwner.mockResolvedValue({ id: 'u2', name: 'Bob' });
    const res = await handleActionCommand({ ...base, args: 'Fix cache <@U2> due:2026-12-05' });
    expect(res.response_type).toBe('in_channel');
    const items = m.replace.mock.calls[0][3];
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ title: 'Fix cache', ownerId: 'u2', dueDate: '2026-12-05' });
    expect(m.update).toHaveBeenCalledWith({ where: { id: 'new' }, data: { source: 'MANUAL' } });
    expect(m.pmCommand).toHaveBeenCalledTimes(1);
  });
  it('refuses an unlinked owner without creating anything', async () => {
    base.resolveOwner.mockResolvedValue(null);
    const res = await handleActionCommand({ ...base, args: 'Fix <@U9>' });
    expect(res.response_type).toBe('ephemeral');
    expect(m.pmCommand).not.toHaveBeenCalled();
  });
  it('refuses a duplicate open item', async () => {
    const res = await handleActionCommand({ ...base, args: 'old' });
    expect(res.text).toContain('already exists');
    expect(m.replace).not.toHaveBeenCalled();
  });
  it('rejects invalid input before touching the postmortem', async () => {
    const res = await handleActionCommand({ ...base, args: 'x due:nope' });
    expect(res.response_type).toBe('ephemeral');
    expect(m.pmCommand).not.toHaveBeenCalled();
  });
});

describe('handleActionsListCommand', () => {
  const input = { incident: { id: 'i1' }, actor: { id: 'u1' } };
  const actor = (role: AuthorizationActor['role']): AuthorizationActor => ({
    id: 'u1',
    role,
    status: 'ACTIVE',
    teamIds: [],
  });
  beforeEach(() => {
    vi.clearAllMocks();
    m.itemFindMany.mockResolvedValue([]);
    m.itemCount.mockResolvedValue(0);
  });

  it('lists only items of published postmortems for someone without postmortem.draft.read', async () => {
    m.resolveActor.mockResolvedValue(actor('AUDITOR'));
    await handleActionsListCommand(input);
    expect(m.itemFindMany.mock.calls[0][0].where).toMatchObject({
      incidentId: 'i1',
      postmortem: { status: 'PUBLISHED' },
    });
    expect(m.itemCount.mock.calls[0][0].where).toMatchObject({
      postmortem: { status: 'PUBLISHED' },
    });
  });

  it('lists draft postmortem items for someone who may read drafts', async () => {
    m.resolveActor.mockResolvedValue(actor('RESPONDER'));
    await handleActionsListCommand(input);
    expect(m.itemFindMany.mock.calls[0][0].where.postmortem).not.toHaveProperty('status');
  });

  it('refuses when the account is not active', async () => {
    m.resolveActor.mockResolvedValue(null);
    const res = await handleActionsListCommand(input);
    expect(res.text).toContain('not active');
    expect(m.itemFindMany).not.toHaveBeenCalled();
  });
});
