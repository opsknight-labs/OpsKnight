import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import {
  loadWarRoomKickoff,
  postWarRoomKickoff,
  renderWarRoomKickoff,
} from '@/lib/chatops/war-room-kickoff';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const posted: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  posted.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      posted.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, ts: '1.2' }), { status: 200 });
    })
  );
});

async function world(options: { kickoff?: boolean } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    { actorId: admin.id, source: 'UI' }
  );
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      warRoomKickoffEnabled: options.kickoff ?? true,
    },
  });
  const service = await createTestService('Checkout API', undefined, { name: 'Checkout API' });
  const incident = await createTestIncident('Checkout errors', service.id);
  const precedent = await createTestIncident('Checkout errors last week', service.id, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  const secret = await createTestIncident('Private <!channel> breach', service.id, {
    visibility: 'PRIVATE',
  });
  const change = await db.changeEvent.create({
    data: {
      serviceId: service.id,
      source: 'ci',
      kind: 'DEPLOY',
      summary: 'checkout v42 released',
      dedupKey: 'run-42',
      occurredAt: new Date(Date.now() - 600_000),
    },
  });
  const runbook = await db.runbook.create({ data: { name: 'Restart checkout pods', slug: 'rcp' } });
  const finding = (kind: string, subjectRef: string, rank = 0) =>
    db.intelligenceFinding.create({
      data: {
        incidentId: incident.id,
        kind: kind as never,
        subjectRef,
        rank,
        evidence: {},
        generation: 1,
        engineVersion: 'test',
      },
    });
  await finding('SIMILAR_INCIDENT', precedent.id, 0);
  await finding('SIMILAR_INCIDENT', secret.id, 1);
  await finding('CHANGE_CORRELATION', change.id);
  await finding('RUNBOOK_RECOMMENDATION', runbook.id);
  return { incident, precedent, secret, change, runbook };
}

describe('war-room kickoff', () => {
  it('collects stored similar incidents, causes and runbooks, never naming a private incident', async () => {
    const w = await world();
    const kickoff = await loadWarRoomKickoff(w.incident.id);
    expect(kickoff).toEqual({
      similar: [
        {
          id: w.precedent.id,
          title: 'Checkout errors last week',
          serviceName: 'Checkout API',
          fix: null,
        },
      ],
      causes: ['Change "checkout v42 released" on Checkout API'],
      runbooks: [{ id: w.runbook.id, name: 'Restart checkout pods' }],
    });
    expect(JSON.stringify(kickoff)).not.toContain('Private');
  });

  it('posts one message into the channel when on, and nothing while the switch is off (the default)', async () => {
    const w = await world({ kickoff: false });
    const input = {
      incidentId: w.incident.id,
      channelId: 'C1',
      botToken: 'xoxb',
      baseUrl: 'https://ok.test/',
    };
    expect(await postWarRoomKickoff(input)).toBe(false);
    expect(posted).toHaveLength(0);
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { warRoomKickoffEnabled: true },
    });
    expect(await postWarRoomKickoff(input)).toBe(true);
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toContain('chat.postMessage');
    expect(posted[0].body.channel).toBe('C1');
    const json = JSON.stringify(posted[0].body.blocks);
    expect(json).toContain(`https://ok.test/incidents/${w.precedent.id}`);
    expect(json).toContain('Restart checkout pods');
  });

  it('posts nothing when nothing was found', async () => {
    const w = await world();
    await db.intelligenceFinding.deleteMany({});
    expect(await loadWarRoomKickoff(w.incident.id)).toBeNull();
  });

  it('escapes stored text so it cannot mention the channel or forge a link', () => {
    const { blocks } = renderWarRoomKickoff(
      { similar: [], causes: ['Change "<!channel> <https://x|y>"'], runbooks: [] },
      'https://ok.test'
    );
    const json = JSON.stringify(blocks);
    expect(json).not.toContain('<!channel>');
    expect(json).not.toContain('<https://x|y>');
  });
});
