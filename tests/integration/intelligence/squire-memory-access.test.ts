import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { recordExchange } from '@/lib/intelligence/conversations/store';
import {
  getConversationForActor,
  listConversationsForActor,
} from '@/lib/intelligence/conversations/view';
import {
  mintContextProof,
  readBrowserContext,
  authorizationContextHash,
} from '@/lib/intelligence/squire/context-proof';
import type { SourceReference } from '@/lib/intelligence/conversations/contract';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await db.aiSettings.create({
    data: {
      id: 'default',
      enabled: true,
      squireEnabled: true,
      squireHistoryEnabled: true,
      updatedAt: new Date(),
    },
  });
});

async function fixture() {
  const team = await createTestTeam('Memory access');
  const user = await createTestUser({ role: 'USER' });
  await db.teamMember.create({ data: { userId: user.id, teamId: team.id } });
  const service = await createTestService('Memory source', team.id);
  const incident = await createTestIncident('Source incident', service.id, { teamId: team.id });
  const source: SourceReference = {
    kind: 'incident',
    id: incident.id,
    handle: randomUUID(),
    version: 'a'.repeat(64),
    observedAt: new Date().toISOString(),
    sourceUpdatedAt: incident.updatedAt.toISOString(),
    dataClass: 'PERSONAL',
  };
  return { user, incident, source, actor: (await resolveUserActor(user.id))! };
}

it('rechecks browser-proof sources after membership changes and source updates', async () => {
  const { user, actor, incident, source } = await fixture();
  const text = 'Verified historical answer';
  const proof = await mintContextProof({
    actor,
    role: 'assistant',
    text,
    dataClass: 'PERSONAL',
    sources: [source],
  });
  expect(
    (
      await readBrowserContext(actor, null, [
        { role: 'assistant', content: text, contextProof: proof },
      ])
    ).messages
  ).toHaveLength(1);
  await db.incident.update({ where: { id: incident.id }, data: { title: 'Changed source' } });
  expect(
    (
      await readBrowserContext(actor, null, [
        { role: 'assistant', content: text, contextProof: proof },
      ])
    ).messages
  ).toHaveLength(0);
  await db.teamMember.deleteMany({ where: { userId: user.id } });
  expect(
    (
      await readBrowserContext((await resolveUserActor(user.id))!, null, [
        { role: 'assistant', content: text, contextProof: proof },
      ])
    ).messages
  ).toHaveLength(0);
});

it('hides derived saved text when a known source becomes unreadable without losing the owner-authored question', async () => {
  const { user, actor, source } = await fixture();
  const id = await recordExchange({
    userId: user.id,
    question: 'My question',
    answer: 'derived-private-canary-54',
    turn: { verified: true, authorizationHash: authorizationContextHash(actor), sources: [source] },
  });
  expect((await getConversationForActor(actor, id))?.messages[1].replayable).toBe(true);
  await db.teamMember.deleteMany({ where: { userId: user.id } });
  const saved = await getConversationForActor((await resolveUserActor(user.id))!, id);
  expect(saved?.messages[0].content).toBe('My question');
  expect(saved?.messages[1].replayable).toBe(false);
  expect(JSON.stringify(saved)).not.toContain('derived-private-canary-54');
  expect(saved?.messages[1].envelope).toBeUndefined();
});

it('keeps a dated answer when its source changes, but excludes it from new AI context', async () => {
  const { user, actor, source, incident } = await fixture();
  const id = await recordExchange({
    userId: user.id,
    question: 'q',
    answer: 'Earlier facts',
    turn: { verified: true, authorizationHash: authorizationContextHash(actor), sources: [source] },
  });
  await db.incident.update({ where: { id: incident.id }, data: { title: 'New facts' } });
  const saved = await getConversationForActor(actor, id);
  expect(saved?.messages[1].content).toBe('Earlier facts');
  expect(saved?.messages[1].replayable).toBe(false);
  expect(saved?.messages[1].notice).toContain('Sources changed');
  expect(saved?.messages[1].contextProof).toBeUndefined();
});

it('removes inaccessible incident conversations from both listing and opening', async () => {
  const { user, actor, incident } = await fixture();
  const id = await recordExchange({
    userId: user.id,
    incidentId: incident.id,
    question: 'q',
    answer: 'a',
  });
  expect((await listConversationsForActor(actor)).map(row => row.id)).toContain(id);
  await db.teamMember.deleteMany({ where: { userId: user.id } });
  const revoked = (await resolveUserActor(user.id))!;
  expect(await listConversationsForActor(revoked)).toEqual([]);
  expect(await getConversationForActor(revoked, id)).toBeNull();
});

it('mints evidence only for actual reads and rejects readable but unretrieved citations', async () => {
  const { actor, incident } = await fixture();
  const { SquireEvidenceRegistry } = await import('@/lib/intelligence/squire/evidence');
  const evidence = new SquireEvidenceRegistry(actor, 'PERSONAL');
  expect(evidence.citations(`/incidents/${incident.id}`)).toEqual([]);
  const result = (await evidence.observe(
    'get_incident',
    { id: incident.id },
    { id: incident.id, title: incident.title, updatedAt: incident.updatedAt.toISOString() }
  )) as { evidence: SourceReference[] };
  expect(evidence.verified).toBe(true);
  expect(result.evidence[0]).toMatchObject({
    kind: 'incident',
    id: incident.id,
    dataClass: 'PERSONAL',
    sourceUpdatedAt: incident.updatedAt.toISOString(),
  });
  const citation = evidence.citations(`[evidence:${result.evidence[0].handle}]`)[0];
  expect(citation).toMatchObject({
    href: `/incidents/${incident.id}`,
    handle: result.evidence[0].handle,
  });
  expect(evidence.citations(`/incidents/${incident.id}extra`)).toEqual([]);
});

it('withholds tool data when a source is revoked and bounds its evidence budget', async () => {
  const { actor, user, incident } = await fixture();
  const { SquireEvidenceRegistry } = await import('@/lib/intelligence/squire/evidence');
  await db.teamMember.deleteMany({ where: { userId: user.id } });
  const revoked = new SquireEvidenceRegistry((await resolveUserActor(user.id))!, 'PERSONAL');
  expect(
    JSON.stringify(
      await revoked.observe(
        'get_incident',
        { id: incident.id },
        { id: incident.id, title: 'revoked-canary-82' }
      )
    )
  ).not.toContain('revoked-canary-82');
  expect(revoked.verified).toBe(false);
  const bounded = new SquireEvidenceRegistry(actor, 'PERSONAL');
  expect(
    await bounded.observe('unknown_tool', {}, { secret: 'unrecognized-canary' })
  ).toHaveProperty('error');
  expect(
    await bounded.observe('get_incident', {}, { id: incident.id, title: 'x'.repeat(33_000) })
  ).toHaveProperty('error');
  expect(bounded.verified).toBe(false);
});

it('keeps evidence replayable across different views of the same unchanged source', async () => {
  const { actor, incident } = await fixture();
  const { SquireEvidenceRegistry } = await import('@/lib/intelligence/squire/evidence');
  const evidence = new SquireEvidenceRegistry(actor, 'PERSONAL');
  const updatedAt = incident.updatedAt.toISOString();
  await evidence.observe(
    'get_incident',
    { id: incident.id },
    { id: incident.id, title: incident.title, updatedAt }
  );
  await evidence.observe('get_timeline', { id: incident.id }, [{ message: 'Recorded event' }]);
  expect(evidence.verified).toBe(true);
  expect(evidence.sources()).toHaveLength(1);
  expect(evidence.sources()[0].sourceUpdatedAt).toBe(updatedAt);
  await evidence.observe(
    'get_incident',
    { id: incident.id },
    {
      id: incident.id,
      title: 'Changed',
      updatedAt: new Date(incident.updatedAt.getTime() + 1_000).toISOString(),
    }
  );
  expect(evidence.verified).toBe(false);
});
