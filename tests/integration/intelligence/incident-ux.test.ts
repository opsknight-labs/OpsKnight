import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only the session is replaced; rbac, the actions, domain commands and the database are real.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next-auth', async original => ({
  ...(await original<typeof import('next-auth')>()),
  getServerSession: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)),
}));
vi.mock('@/lib/auth', () => ({ getAuthOptions: vi.fn(async () => ({})) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import prisma from '@/lib/prisma';
import { resolveUserActor } from '@/lib/authorization-actors';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  getIncidentListBadges,
  noiseFilterWhere,
} from '@/lib/intelligence/incident-ux/list-badges';
import { incidentReadableSql } from '@/lib/intelligence/incident-ux/readable-sql';
import { getIncidentGroupForActor } from '@/lib/intelligence/incident-ux/group-view';
import { getWallboardNoiseTile } from '@/lib/intelligence/incident-ux/wallboard-noise';
import { getIncidentTimeAxisForActor } from '@/lib/intelligence/timeline/service';
import {
  postSummaryAsNoteAction,
  reverseIncidentNoiseDecision,
} from '@/app/(app)/incidents/[id]/noise-actions';
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
  session.userId = null;
});

const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

/** A client that counts every database operation, raw or model, issued through it. */
function countingClient() {
  const ops: string[] = [];
  const client = db.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        ops.push(model ? `${model}.${operation}` : operation);
        return query(args);
      },
    },
  });
  return { client: client as unknown as PrismaClient, ops };
}

async function decision(
  data: Partial<Prisma.PrePagingDecisionUncheckedCreateInput> & {
    serviceId: string;
    control: Prisma.PrePagingDecisionUncheckedCreateInput['control'];
    action: Prisma.PrePagingDecisionUncheckedCreateInput['action'];
  }
) {
  return db.prePagingDecision.create({
    data: { mode: 'ON', applied: true, reason: 'test', evidence: {}, ...data },
  });
}

async function parentChild(childId: string, parentId: string, decision = 'ACCEPTED' as const) {
  return db.incidentRelationship.create({
    data: {
      sourceIncidentId: childId,
      targetIncidentId: parentId,
      type: 'PARENT_CHILD',
      origin: 'RULE',
      decision,
      evidence: { automatic: true },
      engineVersion: 'test',
    },
  });
}

/** Two teams; a scoped USER in team A; incidents of every badge kind on both sides. */
async function seedList() {
  const teamA = await createTestTeam('A');
  const teamB = await createTestTeam('B');
  const admin = await createTestUser({ role: 'ADMIN', name: 'Ada' });
  const scoped = await createTestUser({ role: 'USER', name: 'Sam' });
  await db.teamMember.create({ data: { userId: scoped.id, teamId: teamA.id } });
  const svcA = await createTestService('svc-a', teamA.id);
  const svcB = await createTestService('svc-b', teamB.id);

  const parentA = await createTestIncident('Storm parent A', svcA.id);
  const childA = await createTestIncident('Child of A', svcA.id);
  const parentB = await createTestIncident('Storm parent B (team B)', svcB.id);
  const childOfHidden = await createTestIncident('Child of hidden parent', svcA.id);
  const suppressed = await createTestIncident('Suppressed one', svcA.id, { status: 'SUPPRESSED' });
  const maintained = await createTestIncident('In maintenance', svcA.id);
  const similar = await createTestIncident('Has a similar precedent', svcA.id);
  const precedent = await createTestIncident('Precedent', svcA.id, { status: 'RESOLVED' });
  const hiddenPrecedent = await createTestIncident('Hidden precedent', svcB.id);
  const similarHidden = await createTestIncident('Similar to hidden', svcA.id);
  const stale = await createTestIncident('Stale similar', svcA.id);
  const plain = await createTestIncident('Plain', svcA.id);
  const teamBOnly = await createTestIncident('Team B suppressed', svcB.id);

  await parentChild(childA.id, parentA.id);
  await parentChild(childOfHidden.id, parentB.id);
  await decision({
    serviceId: svcA.id,
    incidentId: parentA.id,
    control: 'STORM',
    action: 'GROUP_CHILD',
  });
  await decision({
    serviceId: svcA.id,
    incidentId: parentA.id,
    control: 'STORM',
    action: 'GROUP_CHILD',
    reversedAt: new Date(),
  });
  await decision({
    serviceId: svcA.id,
    incidentId: suppressed.id,
    control: 'SUPPRESSION',
    action: 'SUPPRESS',
    sourceName: 'Known noisy probe',
  });
  // Shadow and reversed decisions never badge.
  await decision({
    serviceId: svcA.id,
    incidentId: plain.id,
    control: 'SUPPRESSION',
    action: 'SUPPRESS',
    mode: 'SHADOW',
    applied: false,
  });
  await decision({
    serviceId: svcA.id,
    incidentId: plain.id,
    control: 'MAINTENANCE',
    action: 'SUPPRESS',
    reversedAt: new Date(),
  });
  await decision({
    serviceId: svcA.id,
    incidentId: maintained.id,
    control: 'MAINTENANCE',
    action: 'DOWNGRADE',
    sourceName: 'DB upgrade',
  });
  await decision({
    serviceId: svcB.id,
    incidentId: teamBOnly.id,
    control: 'SUPPRESSION',
    action: 'SUPPRESS',
    sourceName: 'B rule',
  });
  const finding = (
    incidentId: string,
    subjectRef: string,
    confidence: number,
    createdAt = new Date()
  ) =>
    db.intelligenceFinding.create({
      data: {
        incidentId,
        kind: 'SIMILAR_INCIDENT',
        subjectRef,
        confidence,
        evidence: {},
        generation: 1,
        engineVersion: 't',
        createdAt,
      },
    });
  await finding(similar.id, precedent.id, 0.92);
  await finding(similarHidden.id, hiddenPrecedent.id, 0.95);
  await finding(stale.id, precedent.id, 0.95, new Date(Date.now() - 10 * 86_400_000));
  await finding(plain.id, precedent.id, 0.5);

  return {
    admin,
    scoped,
    svcA,
    svcB,
    parentA,
    childA,
    parentB,
    childOfHidden,
    suppressed,
    maintained,
    similar,
    precedent,
    similarHidden,
    stale,
    plain,
    teamBOnly,
  };
}

describe('incident list badges', () => {
  it('builds every badge for a page from exactly one database query', async () => {
    const s = await seedList();
    const ids = [
      s.parentA,
      s.childA,
      s.childOfHidden,
      s.suppressed,
      s.maintained,
      s.similar,
      s.similarHidden,
      s.stale,
      s.plain,
      s.teamBOnly,
    ].map(i => i.id);
    const { client, ops } = countingClient();
    const badges = await getIncidentListBadges(ids, await actorOf(s.admin.id), {}, client);
    expect(ops).toEqual(['$queryRaw']);

    expect(badges[s.parentA.id]).toEqual([{ kind: 'parent', count: 2 }]);
    expect(badges[s.childA.id]).toEqual([
      {
        kind: 'grouped',
        parentId: s.parentA.id,
        parentRef: `#${s.parentA.id.slice(-5).toUpperCase()}`,
      },
    ]);
    expect(badges[s.childOfHidden.id]?.[0]).toMatchObject({
      kind: 'grouped',
      parentId: s.parentB.id,
    });
    expect(badges[s.suppressed.id]).toEqual([
      { kind: 'suppressed', label: 'Suppressed by Known noisy probe' },
    ]);
    expect(badges[s.maintained.id]).toEqual([
      { kind: 'maintenance', label: 'In maintenance: DB upgrade' },
    ]);
    expect(badges[s.similar.id]).toEqual([
      {
        kind: 'similar',
        incidentId: s.precedent.id,
        ref: `#${s.precedent.id.slice(-5).toUpperCase()}`,
        confidencePercent: 92,
      },
    ]);
    // Stale or low-confidence findings, shadow and reversed decisions: no badge.
    expect(badges[s.stale.id]).toBeUndefined();
    expect(badges[s.plain.id]).toBeUndefined();
  });

  it('shows a scoped viewer only what they may read', async () => {
    const s = await seedList();
    const ids = [s.childA, s.childOfHidden, s.similar, s.similarHidden, s.teamBOnly].map(i => i.id);
    const { client, ops } = countingClient();
    const badges = await getIncidentListBadges(ids, await actorOf(s.scoped.id), {}, client);
    expect(ops).toEqual(['$queryRaw']);
    expect(badges[s.childA.id]?.[0]).toMatchObject({ kind: 'grouped', parentId: s.parentA.id });
    // The parent is in team B: the child is still marked grouped, but the parent is not revealed.
    expect(badges[s.childOfHidden.id]).toEqual([
      { kind: 'grouped', parentId: null, parentRef: null },
    ]);
    expect(badges[s.similar.id]?.[0]).toMatchObject({
      kind: 'similar',
      incidentId: s.precedent.id,
    });
    expect(badges[s.similarHidden.id]).toBeUndefined();
    // An incident the viewer cannot read gets nothing, even if its id is passed in.
    expect(badges[s.teamBOnly.id]).toBeUndefined();
  });

  it('returns nothing and issues no query for an empty page', async () => {
    const s = await seedList();
    const { client, ops } = countingClient();
    expect(await getIncidentListBadges([], await actorOf(s.admin.id), {}, client)).toEqual({});
    expect(ops).toEqual([]);
  });

  it('filters the list by noise decision', async () => {
    const s = await seedList();
    const actor = await actorOf(s.scoped.id);
    const titles = async (filter: 'grouped' | 'suppressed' | 'maintenance') =>
      (
        await db.incident.findMany({
          where: { AND: [incidentReadWhere(actor), noiseFilterWhere(filter)] },
          select: { title: true },
          orderBy: { title: 'asc' },
        })
      ).map(row => row.title);
    expect(await titles('grouped')).toEqual([
      'Child of A',
      'Child of hidden parent',
      'Storm parent A',
    ]);
    expect(await titles('suppressed')).toEqual(['Suppressed one']);
    expect(await titles('maintenance')).toEqual(['In maintenance']);
  });

  it('readable SQL agrees with incidentReadWhere', async () => {
    const s = await seedList();
    const other = await createTestUser({ role: 'USER' });
    const svcB = s.svcB;
    const assigned = await createTestIncident('Assigned to Sam', svcB.id, {
      assigneeId: s.scoped.id,
    });
    const watched = await createTestIncident('Watched by Sam', svcB.id);
    await db.incidentWatcher.create({ data: { incidentId: watched.id, userId: s.scoped.id } });
    await createTestIncident('Private in A', s.svcA.id, { visibility: 'PRIVATE' });
    await createTestIncident('Assigned elsewhere', svcB.id, { assigneeId: other.id });
    for (const user of [s.scoped, s.admin, other]) {
      const actor = await actorOf(user.id);
      const viaPrisma = (
        await db.incident.findMany({ where: incidentReadWhere(actor), select: { id: true } })
      )
        .map(r => r.id)
        .sort();
      const viaSql = (
        await db.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT i."id" FROM "Incident" i WHERE ${incidentReadableSql('i', actor)}`
        )
      )
        .map(r => r.id)
        .sort();
      expect(viaSql).toEqual(viaPrisma);
    }
    expect(assigned.id).toBeTruthy();
  });
});

describe('group view', () => {
  it('shows a parent its children and grouped alerts, and a child its parent', async () => {
    const s = await seedList();
    const alert = await db.alert.create({
      data: {
        serviceId: s.svcA.id,
        incidentId: s.parentA.id,
        payload: { summary: 'db-1 CPU high' },
      },
    });
    await db.prePagingDecision.updateMany({
      where: { incidentId: s.parentA.id, reversedAt: null },
      data: { alertId: alert.id },
    });
    const admin = await actorOf(s.admin.id);
    const parent = await getIncidentGroupForActor(s.parentA.id, admin);
    expect(parent?.role).toBe('PARENT');
    expect(parent?.members.map(m => m.kind).sort()).toEqual(['ALERT', 'ALERT', 'INCIDENT']);
    const live = parent?.members.find(m => m.kind === 'ALERT' && !m.reversed);
    expect(live).toMatchObject({ title: 'db-1 CPU high', ungroupable: true });
    expect(parent?.canUngroupAlerts).toBe(true);

    const child = await getIncidentGroupForActor(s.childA.id, admin);
    expect(child?.role).toBe('CHILD');
    expect(child?.parent?.id).toBe(s.parentA.id);
    expect(child?.members.find(m => m.kind === 'INCIDENT')).toMatchObject({ current: true });

    // Not grouped at all: no view.
    expect(await getIncidentGroupForActor(s.plain.id, admin)).toBeNull();
  });

  it('hides a parent the viewer may not read, and ungroup permissions follow the role', async () => {
    const s = await seedList();
    const scoped = await actorOf(s.scoped.id);
    const hidden = await getIncidentGroupForActor(s.childOfHidden.id, scoped);
    expect(hidden).toMatchObject({ role: 'CHILD', parentHidden: true, parent: null, members: [] });
    const own = await getIncidentGroupForActor(s.parentA.id, scoped);
    expect(own?.canUngroupAlerts).toBe(false);
    // Not readable at all: nothing.
    expect(await getIncidentGroupForActor(s.parentB.id, scoped)).toBeNull();
  });
});

describe('timeline intelligence events', () => {
  it('lists noise decisions with why, grouping and suggestion decisions; reversal only for managers', async () => {
    const s = await seedList();
    const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae' });
    const rel = await db.incidentRelationship.findFirstOrThrow({
      where: { sourceIncidentId: s.childA.id },
    });
    await db.incidentRelationshipEvent.create({
      data: {
        relationshipId: rel.id,
        toDecision: 'ACCEPTED',
        actorType: 'SYSTEM',
        reasonCode: 'AUTO_GROUP',
      },
    });
    const triage = await db.intelligenceFinding.create({
      data: {
        incidentId: s.childA.id,
        kind: 'TRIAGE_URGENCY',
        subjectRef: 'HIGH',
        confidence: 0.9,
        evidence: {},
        generation: 1,
        engineVersion: 't',
      },
    });
    await db.intelligenceFeedback.create({
      data: {
        subjectType: 'FINDING',
        subjectId: triage.id,
        verdict: 'HELPFUL',
        actorId: responder.id,
      },
    });
    await decision({
      serviceId: s.svcA.id,
      incidentId: s.childA.id,
      control: 'SUPPRESSION',
      action: 'SUPPRESS',
      sourceName: 'Known noisy probe',
      reason: 'Matched probe=synthetic',
      evidence: { threshold: 3 },
    });

    const admin = await getIncidentTimeAxisForActor(s.childA.id, await actorOf(s.admin.id));
    const noise = admin!.entries.find(e => e.kind === 'NOISE_DECISION');
    expect(noise).toMatchObject({
      title: 'Suppressed by rule “Known noisy probe”',
      why: ['Matched probe=synthetic', 'Threshold: 3'],
      reversal: { pages: true },
    });
    expect(admin!.entries.find(e => e.kind === 'GROUPING')).toMatchObject({
      title: `Grouped into parent #${s.parentA.id.slice(-5).toUpperCase()} Storm parent A`,
      detail: 'Grouping accepted automatically',
      href: `/incidents/${s.parentA.id}`,
    });
    expect(admin!.entries.find(e => e.kind === 'TRIAGE')).toMatchObject({
      title: 'Triage suggestion for urgency (high) accepted',
      detail: 'by Rae',
    });
    expect(admin!.canReverse).toBe(true);

    const asResponder = await getIncidentTimeAxisForActor(s.childA.id, await actorOf(responder.id));
    expect(asResponder!.canReverse).toBe(false);
    expect(asResponder!.entries.find(e => e.kind === 'NOISE_DECISION')?.reversal).toBeNull();
  });

  it('does not name a grouped-with incident the viewer may not read', async () => {
    const s = await seedList();
    const rel = await db.incidentRelationship.findFirstOrThrow({
      where: { sourceIncidentId: s.childOfHidden.id },
    });
    await db.incidentRelationshipEvent.create({
      data: {
        relationshipId: rel.id,
        toDecision: 'ACCEPTED',
        actorType: 'SYSTEM',
        reasonCode: 'AUTO_GROUP',
      },
    });
    const axis = await getIncidentTimeAxisForActor(s.childOfHidden.id, await actorOf(s.scoped.id));
    const grouping = axis!.entries.find(e => e.kind === 'GROUPING');
    expect(grouping?.title).toBe('Grouped into parent an incident you cannot view');
    expect(grouping?.href).toBeNull();
    expect(JSON.stringify(axis)).not.toContain('team B');
  });
});

describe('incident page actions', () => {
  const summary = {
    headline: 'Checkout failing',
    currentState: 'Rolling back.',
    impact: '',
    keyEvents: ['Deploy 10:00'],
    possibleCauses: [],
    nextSteps: [],
  };

  it('posts a summary as a note for a responder', async () => {
    const s = await seedList();
    const responder = await createTestUser({ role: 'RESPONDER', name: 'Rae' });
    session.userId = responder.id;
    const result = await postSummaryAsNoteAction(s.childA.id, { summary, model: 'm' });
    expect(result).toMatchObject({ ok: true, done: true });
    const notes = await db.incidentNote.findMany({ where: { incidentId: s.childA.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].content).toContain('Summary: Checkout failing');
    expect(notes[0].userId).toBe(responder.id);
  });

  it('refuses to post for a viewer without the note permission, and rejects malformed input', async () => {
    const s = await seedList();
    session.userId = s.scoped.id;
    const denied = await postSummaryAsNoteAction(s.childA.id, { summary });
    expect(denied.ok).toBe(false);
    expect(denied.message).toMatch(/Responders and Admins|permission/i);
    session.userId = s.admin.id;
    const malformed = await postSummaryAsNoteAction(s.childA.id, { summary: { headline: 'x' } });
    expect(malformed.ok).toBe(false);
    expect(await db.incidentNote.count()).toBe(0);
  });

  it('reverses a noise decision only for managers and only on its own incident', async () => {
    const s = await seedList();
    const own = await decision({
      serviceId: s.svcA.id,
      incidentId: s.suppressed.id,
      control: 'SUPPRESSION',
      action: 'DOWNGRADE',
    });
    const form = (id: string) => {
      const data = new FormData();
      data.set('decisionId', id);
      return data;
    };
    const responder = await createTestUser({ role: 'RESPONDER' });
    session.userId = responder.id;
    const denied = await reverseIncidentNoiseDecision(
      s.suppressed.id,
      { ok: true, message: '' },
      form(own.id)
    );
    expect(denied.ok).toBe(false);
    expect(
      (await db.prePagingDecision.findUniqueOrThrow({ where: { id: own.id } })).reversedAt
    ).toBeNull();

    session.userId = s.admin.id;
    const wrongIncident = await reverseIncidentNoiseDecision(
      s.plain.id,
      { ok: true, message: '' },
      form(own.id)
    );
    expect(wrongIncident).toMatchObject({
      ok: false,
      message: 'That decision is not on this incident.',
    });

    // DOWNGRADE did not keep anything from paging: reversal records the mistake and pages nothing.
    const reversed = await reverseIncidentNoiseDecision(
      s.suppressed.id,
      { ok: true, message: '' },
      form(own.id)
    );
    expect(reversed).toMatchObject({ ok: true, done: true, pagedIncidentId: null });
    expect(
      (await db.prePagingDecision.findUniqueOrThrow({ where: { id: own.id } })).reversedAt
    ).not.toBeNull();
    const again = await reverseIncidentNoiseDecision(
      s.suppressed.id,
      { ok: true, message: '' },
      form(own.id)
    );
    expect(again).toMatchObject({ ok: false, message: 'Already reversed.' });
  });
});

describe('wallboard noise tile', () => {
  it('is hidden from viewers without intelligence read, off until a policy is on, then shows KPIs', async () => {
    const s = await seedList();
    expect(await getWallboardNoiseTile(await actorOf(s.scoped.id))).toBeNull();
    const admin = await actorOf(s.admin.id);
    expect(await getWallboardNoiseTile(admin)).toEqual({ state: 'off', canManage: true });
    await db.noiseControlPolicy.create({
      data: { scopeKey: 'global', mode: 'ON', definition: {} },
    });
    const tile = await getWallboardNoiseTile(admin, {}, prisma);
    expect(tile).toMatchObject({ state: 'on', shadowOnly: false });
    // Applied SUPPRESS + GROUP_CHILD (unreversed and reversed) in the last day count as pages avoided.
    expect(tile && tile.state === 'on' && tile.pagesAvoided).toBeGreaterThanOrEqual(4);
  });
});
