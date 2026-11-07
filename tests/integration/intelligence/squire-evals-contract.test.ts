import { beforeAll, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { resetDialogueMemory } from '@/lib/intelligence/squire/basic/state';
import { resetEntityCache } from '@/lib/intelligence/squire/basic/entities';
import { resetBasicReadCaches } from '@/lib/intelligence/squire/basic/reads';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { BASIC_CASES } from '../../evals/squire/basic-cases';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * The mocked-model evaluation tier: every structural case runs against the deterministic assistant on a
 * seeded database, with no provider, on every pull request. The live-model tier (`tests/evals/squire`)
 * runs nightly with a key.
 */
describe('Squire structural evaluation (no model)', () => {
  let actor: NonNullable<Awaited<ReturnType<typeof resolveUserActor>>>;
  let incidentId: string;
  let serviceId: string;

  beforeAll(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test DB required');
    await resetDatabase();
    resetDialogueMemory();
    resetEntityCache();
    resetBasicReadCaches();
    const team = await createTestTeam('Checkout');
    const outsiders = await createTestTeam('Outsiders');
    const responder = await createTestUser({ role: 'RESPONDER', name: 'Eval Responder' });
    await db.teamMember.create({ data: { userId: responder.id, teamId: team.id, role: 'MEMBER' } });
    const checkout = await createTestService('Checkout API', team.id);
    serviceId = checkout.id;
    await createTestService('Payments Worker', team.id);
    await createTestService('Payments API', team.id);
    const hidden = await createTestService('Hidden Payroll', outsiders.id);
    await createTestIncident('Hidden payroll outage', hidden.id, {
      teamId: outsiders.id,
      description: 'Payroll secret',
    });
    const incidents = await Promise.all(
      Array.from({ length: 7 }, (_, i) =>
        createTestIncident(`Pool exhausted ${i + 1}`, checkout.id, { assigneeId: responder.id })
      )
    );
    incidentId = incidents[0].id;
    await db.incident.update({
      where: { id: incidents[6].id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await db.changeEvent.create({
      data: {
        serviceId: checkout.id,
        source: 'ci',
        kind: 'DEPLOY',
        summary: 'Checkout release 42',
        occurredAt: new Date(Date.now() - 600_000),
      },
    });
    const runbook = await db.runbook.create({
      data: { name: 'Database pool reset', description: 'Resets the pool', tags: ['database'] },
    });
    void runbook;
    await db.postmortem
      .create({
        data: { incidentId: incidents[6].id, title: 'Database pool postmortem', status: 'DRAFT' },
      })
      .catch(() => undefined);
    await db.actionItem
      .create({
        data: {
          incidentId: incidents[6].id,
          title: 'Increase pool visibility',
          status: 'OPEN',
          dueDate: new Date(Date.now() - 86_400_000),
          ownerId: responder.id,
        },
      })
      .catch(() => undefined);
    await db.aiSettings.create({
      data: { id: 'default', enabled: false, squireEnabled: true, squireHistoryEnabled: false },
    });
    actor = (await resolveUserActor(responder.id))!;
  });

  async function ask(
    question: string,
    options: {
      onIncident?: boolean;
      onService?: boolean;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    } = {}
  ) {
    const events: SquireEvent[] = [];
    for await (const event of streamSquire(actor, {
      message: question,
      history: options.history ?? [],
      ...(options.onIncident ? { incidentId } : {}),
      ...(options.onService ? { pageContext: { kind: 'service' as const, id: serviceId } } : {}),
    }))
      events.push(event);
    const text = events
      .filter(e => e.type === 'delta')
      .map(e => (e as { text: string }).text)
      .join('');
    const meta = events.find(e => e.type === 'meta') as
      Extract<SquireEvent, { type: 'meta' }> | undefined;
    const proposals = events
      .filter(e => e.type === 'proposal')
      .map(e => (e as Extract<SquireEvent, { type: 'proposal' }>).proposal);
    const citations =
      (events.find(e => e.type === 'citations') as { items?: unknown[] } | undefined)?.items ?? [];
    const suggestions =
      (events.find(e => e.type === 'suggestions') as { items?: string[] } | undefined)?.items ?? [];
    return { text, meta, proposals, citations, suggestions };
  }

  it.each(BASIC_CASES.map(c => [c.id, c] as const))('%s', async (_id, c) => {
    const result = await ask(c.question, { onIncident: c.onIncident, onService: c.onService });
    expect(result.meta?.mode).toBe('basic');
    expect(result.meta?.intent).toBe(c.expectIntent);
    for (const text of c.mustContain ?? []) expect(result.text).toContain(text);
    for (const text of c.mustNotContain ?? []) expect(result.text).not.toContain(text);
    if (c.expectProposal) expect(result.proposals.map(p => p.action)).toContain(c.expectProposal);
    if (c.forbidProposal) expect(result.proposals).toHaveLength(0);
    if (c.mustCite) expect(result.citations.length).toBeGreaterThan(0);
    if (c.expectClarification) expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
    if (c.then) {
      const next = await ask(c.then.question, {
        onIncident: c.onIncident,
        onService: c.onService,
        history: [
          { role: 'user', content: c.question },
          { role: 'assistant', content: result.text },
        ],
      });
      expect(next.meta?.intent).toBe(c.then.expectIntent);
      for (const text of c.then.mustContain ?? []) expect(next.text).toContain(text);
      if (c.then.expectProposal)
        expect(next.proposals.map(p => p.action)).toContain(c.then.expectProposal);
    }
  });
});
