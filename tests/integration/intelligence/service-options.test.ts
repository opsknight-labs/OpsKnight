import { beforeEach, expect, it } from 'vitest';
import { listReadableServiceOptions } from '@/lib/intelligence/settings/service-options';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resetDatabase, testPrisma as db, createTestTeam } from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
async function fleet() {
  const team = await createTestTeam('Quality fleet');
  await db.service.createMany({
    data: [
      ...Array.from({ length: 120 }, (_, i) => ({
        id: `visible-${i}`,
        name: `Fleet ${String(i).padStart(3, '0')}`,
        teamId: team.id,
      })),
      ...Array.from({ length: 30 }, (_, i) => ({ id: `hidden-${i}`, name: `AAA private ${i}` })),
    ],
  });
  const actor: AuthorizationActor = {
    id: 'reader',
    role: 'USER',
    status: 'ACTIVE',
    teamIds: [team.id],
  };
  return actor;
}
it('paginates a fleet beyond the old first-100 cap with scope applied before LIMIT', async () => {
  const actor = await fleet();
  const seen: string[] = [];
  let after: string | undefined;
  do {
    const page = await listReadableServiceOptions(actor, { after });
    expect(page.services.length).toBeLessThanOrEqual(25);
    expect(page.services.every(row => row.id.startsWith('visible-'))).toBe(true);
    seen.push(...page.services.map(row => row.id));
    after = page.next;
  } while (after);
  expect(seen).toHaveLength(120);
  expect(new Set(seen).size).toBe(120);
  expect(seen.at(-1)).toBe('visible-119');
});
it('finds a service beyond the first hundred using case-insensitive search', async () => {
  const actor = await fleet();
  const page = await listReadableServiceOptions(actor, { q: 'fLEEt 119' });
  expect(page.services.map(row => row.id)).toEqual(['visible-119']);
  expect(page.next).toBeUndefined();
  expect((await listReadableServiceOptions(actor, { q: 'private' })).services).toEqual([]);
});
it('retains an explicitly chosen readable service across search pages without exposing a hidden selection', async () => {
  const actor = await fleet();
  const selected = await listReadableServiceOptions(actor, {
    q: 'Fleet 00',
    serviceId: 'visible-119',
  });
  expect(selected.selected?.id).toBe('visible-119');
  expect(selected.services.some(row => row.id === 'visible-119')).toBe(false);
  expect((await listReadableServiceOptions(actor, { serviceId: 'hidden-0' })).selected).toBeNull();
});
it('rejects hidden, deleted and search-mismatched cursors without revealing their existence', async () => {
  const actor = await fleet();
  const hidden = await listReadableServiceOptions(actor, { after: 'hidden-0' });
  const missing = await listReadableServiceOptions(actor, { after: 'not-present' });
  expect({ ...hidden, after: undefined }).toEqual({ ...missing, after: undefined });
  expect(hidden.services).toEqual([]);
  expect(hidden.error).toBeTruthy();
  expect(
    (await listReadableServiceOptions(actor, { q: '119', after: 'visible-0' })).services
  ).toEqual([]);
});
it('validates repeated and oversized query input before a search and rejects disabled actors', async () => {
  const actor = await fleet();
  for (const input of [
    { q: ['Fleet', 'private'] },
    { q: 'x'.repeat(81) },
    { serviceId: ['hidden-0'] },
  ]) {
    const result = await listReadableServiceOptions(actor, input);
    expect(result.services).toEqual([]);
    expect(result.selected).toBeNull();
    expect(result.error).toBeTruthy();
  }
  await expect(listReadableServiceOptions({ ...actor, status: 'DISABLED' }, {})).rejects.toThrow();
});

it('treats SQL pattern characters as literal service-name text', async () => {
  const actor = await fleet();
  const teamId = actor.teamIds[0];
  await db.service.createMany({
    data: [
      { name: '100% Cache', teamId },
      { name: '1000 Cache', teamId },
      { name: 'Queue_primary', teamId },
    ],
  });
  expect(
    (await listReadableServiceOptions(actor, { q: '100%' })).services.map(row => row.name)
  ).toEqual(['100% Cache']);
  expect(
    (await listReadableServiceOptions(actor, { q: '_' })).services.map(row => row.name)
  ).toEqual(['Queue_primary']);
});
