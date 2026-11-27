import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import {
  ERASED,
  buildIdentifierMatcher,
  pseudonymiseSubjectAuditRows,
  scrubJsonIdentifiers,
  subjectAuditAboutWhere,
  subjectAuditOwnWhere,
  subjectAuditRowsWhere,
} from '@/lib/privacy/erasure/audit-pseudonymise';

const matcher = (over: Partial<Parameters<typeof buildIdentifierMatcher>[0]> = {}) => {
  const built = buildIdentifierMatcher({
    emails: ['alice@example.com'],
    phones: ['+15550100'],
    names: ['Alice Smith'],
    ips: ['203.0.113.7'],
    ...over,
  });
  if (!built) throw new Error('expected a matcher');
  return built;
};

describe('scrubJsonIdentifiers', () => {
  it('replaces the email, name, phone and IP wherever they appear inside string values', () => {
    const result = scrubJsonIdentifiers(
      {
        action: 'invite',
        email: 'Alice@Example.com',
        note: 'Alice Smith called +15550100 from 203.0.113.7.',
        nested: [{ who: 'alice smith' }, 'plain'],
        count: 3,
        flag: true,
        nothing: null,
      },
      matcher()
    );
    expect(result.changed).toBe(true);
    expect(result.value).toEqual({
      action: 'invite',
      email: ERASED,
      note: `${ERASED} called ${ERASED} from ${ERASED}.`,
      nested: [{ who: ERASED }, 'plain'],
      count: 3,
      flag: true,
      nothing: null,
    });
  });

  it('leaves structure, keys and unrelated values alone and reports no change', () => {
    const doc = { 'alice@example.com': 'kept key', list: [1, 'ok'], deep: { role: 'RESPONDER' } };
    const result = scrubJsonIdentifiers(doc, matcher());
    expect(result.changed).toBe(false);
    expect(result.value).toEqual(doc);
  });

  it('matches IPs and names only as whole tokens', () => {
    const result = scrubJsonIdentifiers(
      ['11.203.113.7', '203.0.113.75', '203.0.113.7.1', 'Alice Smithson', 'ip=203.0.113.7'],
      matcher()
    );
    expect(result.value).toEqual([
      '11.203.113.7',
      '203.0.113.75',
      '203.0.113.7.1',
      'Alice Smithson',
      `ip=${ERASED}`,
    ]);
  });

  it('ignores a name or phone too short to be an identifier', () => {
    expect(
      buildIdentifierMatcher({ names: ['Al'], phones: ['123'], emails: [], ips: [] })
    ).toBeNull();
    const withEmail = matcher({ names: ['Al'], phones: ['123'], ips: [] });
    expect(scrubJsonIdentifiers('Al paged 123 about Albert', withEmail).changed).toBe(false);
  });

  it('is idempotent, even for a name that appears inside the marker', () => {
    const erased = matcher({ names: ['Erased'], emails: [], phones: [], ips: [] });
    const once = scrubJsonIdentifiers({ a: 'Erased user' }, erased);
    expect(once.value).toEqual({ a: `${ERASED} user` });
    const twice = scrubJsonIdentifiers(once.value, erased);
    expect(twice.changed).toBe(false);
    expect(twice.value).toEqual(once.value);
  });

  it('builds no matcher when there is nothing to match', () => {
    expect(buildIdentifierMatcher({ emails: [], phones: [], names: [], ips: [] })).toBeNull();
  });
});

describe('subject audit row selection', () => {
  it('selects rows the subject performed or is keyed by, and rows about their account', () => {
    expect(subjectAuditOwnWhere('u1', 'alice@example.com')).toEqual({
      OR: [
        { actorId: 'u1' },
        { actorEmail: 'alice@example.com' },
        { targetEmail: 'alice@example.com' },
        { entityId: { equals: 'alice@example.com', mode: 'insensitive' } },
      ],
    });
    expect(subjectAuditOwnWhere('u1', null)).toEqual({ OR: [{ actorId: 'u1' }] });
    expect(subjectAuditAboutWhere('u1')).toEqual({ entityType: 'USER', entityId: 'u1' });
    expect(subjectAuditRowsWhere('u1', null)).toEqual({
      OR: [{ OR: [{ actorId: 'u1' }] }, { entityType: 'USER', entityId: 'u1' }],
    });
  });
});

describe('pseudonymiseSubjectAuditRows', () => {
  type StoredRow = { id: string; details: unknown };

  /** A transaction whose `details` column lives in memory, so a second run sees the first run's writes. */
  function fakeTx(options: { held?: string[]; rows: StoredRow[]; ips?: Array<string | null> }) {
    const store = new Map(options.rows.map(row => [row.id, row.details]));
    const findMany = vi.fn(async (args: { where: Record<string, unknown>; select: object }) => {
      const where = args.where as { id?: { in: string[] }; AND?: unknown[] };
      if (where.id) {
        return where.id.in.map(id => ({ id, details: store.get(id) ?? null }));
      }
      if ('ip' in args.select) return (options.ips ?? []).map(ip => ({ ip }));
      return options.rows.map(row => ({ id: row.id }));
    });
    const $executeRaw = vi.fn(async (_strings: TemplateStringsArray, ids: string[], docs: string[]) => {
      ids.forEach((id, index) => store.set(id, JSON.parse(docs.at(index) ?? 'null')));
      return ids.length;
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      auditLog: { findMany, updateMany },
      dataRetentionHold: {
        findMany: vi.fn().mockResolvedValue((options.held ?? []).map(scopeId => ({ scopeId }))),
      },
      $executeRaw,
    };
    return { tx: tx as unknown as Prisma.TransactionClient, store, findMany, $executeRaw, updateMany };
  }

  const subject = {
    id: 'u1',
    email: 'Alice@Example.com',
    name: 'Alice Smith',
    phoneNumber: '+15550100',
  };

  it('scrubs the details of the subject rows, clears their IP, and counts what it did', async () => {
    const { tx, store, $executeRaw, updateMany } = fakeTx({
      rows: [
        { id: 'a1', details: { email: 'alice@example.com', ip: '203.0.113.7', action: 'login' } },
        { id: 'a2', details: { path: '/incidents' } },
        { id: 'a3', details: null },
      ],
      ips: ['203.0.113.7'],
    });

    const result = await pseudonymiseSubjectAuditRows(tx, subject);

    expect(result).toEqual({ rows: 3, detailsScrubbed: 1, ipCleared: 2 });
    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(store.get('a1')).toEqual({ email: ERASED, ip: ERASED, action: 'login' });
    expect(store.get('a2')).toEqual({ path: '/incidents' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { AND: [subjectAuditOwnWhere('u1', 'alice@example.com'), {}] },
      data: { ip: null },
    });
    // Only the IP is written through the model; no other column is touched here.
    expect(Object.keys(updateMany.mock.calls[0][0].data)).toEqual(['ip']);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { tx, $executeRaw, store } = fakeTx({
      rows: [{ id: 'a1', details: { email: 'alice@example.com', who: 'Alice Smith' } }],
    });
    await pseudonymiseSubjectAuditRows(tx, subject);
    const afterFirst = JSON.stringify([...store.entries()]);

    const second = await pseudonymiseSubjectAuditRows(tx, subject);

    expect(second.detailsScrubbed).toBe(0);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify([...store.entries()])).toBe(afterFirst);
  });

  it('leaves rows a legal hold on another user protects out of both the scrub and the IP clear', async () => {
    const { tx, findMany, updateMany } = fakeTx({
      held: ['held-user'],
      rows: [{ id: 'a1', details: { email: 'alice@example.com' } }],
    });

    await pseudonymiseSubjectAuditRows(tx, subject);

    const outsideHold = {
      AND: [
        { OR: [{ actorId: null }, { actorId: { notIn: ['held-user'] } }] },
        {
          OR: [{ entityType: { not: 'USER' } }, { entityId: null }, { entityId: { notIn: ['held-user'] } }],
        },
      ],
    };
    const rowSelection = findMany.mock.calls.find(
      ([args]) => !('ip' in args.select) && !('id' in args.where)
    )?.[0];
    expect(rowSelection?.where).toEqual({
      AND: [subjectAuditRowsWhere('u1', 'alice@example.com'), outsideHold],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { AND: [subjectAuditOwnWhere('u1', 'alice@example.com'), outsideHold] },
      data: { ip: null },
    });
  });

  it('only clears the IP when the subject has no identifier to match in details', async () => {
    const { tx, $executeRaw, updateMany } = fakeTx({ rows: [{ id: 'a1', details: { x: 1 } }] });
    await pseudonymiseSubjectAuditRows(tx, { id: 'u1', email: null });
    expect($executeRaw).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('works through a large subject in batches of 500 rows', async () => {
    const rows = Array.from({ length: 1201 }, (_, index) => ({
      id: `a${index}`,
      details: { email: 'alice@example.com' },
    }));
    const { tx, $executeRaw } = fakeTx({ rows });

    const result = await pseudonymiseSubjectAuditRows(tx, subject);

    expect(result.detailsScrubbed).toBe(1201);
    expect($executeRaw).toHaveBeenCalledTimes(3);
  });
});
