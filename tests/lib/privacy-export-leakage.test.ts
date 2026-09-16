import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A minimal fake Prisma that actually respects `where` and `select`, unlike a
 * plain vi.fn() stub. This is what makes the test meaningful: if a fetcher in
 * domains.ts ever drops its `where` scope or widens its `select`, this fake
 * database — not just a mock assertion — will hand back the leaking data and
 * the test will fail on real content, not on "was called with X".
 *
 * Everything the vi.mock('@/lib/prisma', ...) factory needs must be built
 * inside vi.hoisted(), since the factory itself is hoisted above these
 * top-level consts.
 */
const fixtures = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  // Uses Map/Object.entries/Object.fromEntries throughout instead of
  // `obj[dynamicKey]` bracket access, so this fixture helper never trips
  // object-injection style static analysis in the first place.
  function applySelect(row: Row, select?: Record<string, unknown>): Row {
    if (!select) return row;
    const selectMap = new Map(Object.entries(select));
    const projectedEntries = Object.entries(row).flatMap(
      ([key, rowValue]): Array<[string, unknown]> => {
        const selectValue = selectMap.get(key);
        if (selectValue === true) return [[key, rowValue]];
        if (selectValue && typeof selectValue === 'object' && 'select' in selectValue) {
          const nestedSelect = (selectValue as { select: Record<string, unknown> }).select;
          const nestedValue = Array.isArray(rowValue)
            ? rowValue.map(item => applySelect(item as Row, nestedSelect))
            : rowValue
              ? applySelect(rowValue as Row, nestedSelect)
              : rowValue;
          return [[key, nestedValue]];
        }
        return [];
      }
    );
    return Object.fromEntries(projectedEntries);
  }

  function matchesWhere(row: Row, where: Record<string, unknown>): boolean {
    const rowMap = new Map(Object.entries(row));
    return Object.entries(where).every(([key, expected]) => {
      if (key === 'OR' && Array.isArray(expected)) {
        return expected.some(clause => matchesWhere(row, clause as Record<string, unknown>));
      }
      return rowMap.get(key) === expected;
    });
  }

  function makeFindMany(rows: Row[]) {
    return vi.fn(
      async ({
        where,
        select,
        cursor,
        skip,
        take,
      }: {
        where?: Record<string, unknown>;
        select?: Record<string, unknown>;
        cursor?: { id: string };
        skip?: number;
        take?: number;
      }) => {
        const matched = where ? rows.filter(row => matchesWhere(row, where)) : rows;
        const sorted = [...matched].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        let page = sorted;
        if (cursor) {
          const cursorIndex = sorted.findIndex(row => row.id === cursor.id);
          page = cursorIndex === -1 ? [] : sorted.slice(cursorIndex + (skip ?? 0));
        }
        if (typeof take === 'number') page = page.slice(0, take);
        return page.map(row => applySelect(row, select));
      }
    );
  }

  function makeCount(rows: Row[]) {
    return vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
      return where ? rows.filter(row => matchesWhere(row, where)).length : rows.length;
    });
  }

  function makeFindUnique(rows: Row[]) {
    return vi.fn(
      async ({
        where,
        select,
      }: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }) => {
        const match = rows.find(row => matchesWhere(row, where));
        return match ? applySelect(match, select) : null;
      }
    );
  }

  const USER_A = {
    id: 'cuserA0000001',
    name: 'Alice Example',
    email: 'alice@example.com',
    role: 'USER',
    status: 'ACTIVE',
    timeZone: 'UTC',
    phoneNumber: '+15550001111',
    department: 'Engineering',
    jobTitle: 'SRE',
    passwordHash: 'super-secret-hash-a-must-never-leak',
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: false,
    pushNotificationsEnabled: false,
    whatsappNotificationsEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  const USER_B = {
    id: 'cuserB0000002',
    name: 'Bob Example',
    email: 'bob@example.com',
    role: 'USER',
    status: 'ACTIVE',
    timeZone: 'UTC',
    phoneNumber: '+15559998888',
    department: 'Sales',
    jobTitle: 'AE',
    passwordHash: 'super-secret-hash-b-must-never-leak',
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: false,
    pushNotificationsEnabled: false,
    whatsappNotificationsEnabled: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  const TEAM = { id: 'cteam0000001', name: 'Platform Team' };
  const SERVICE = { id: 'csvc00000001', name: 'Payments API' };
  const SCHEDULE = { id: 'csched0000001', name: 'Primary Rotation' };

  const OIDC_IDENTITIES = [
    {
      id: 'coidcA000001',
      userId: USER_A.id,
      issuer: 'https://idp.example.com',
      email: USER_A.email,
      subject: 'idp-sub-alice-secret',
      lastLoginAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: 'coidcB000002',
      userId: USER_B.id,
      issuer: 'https://idp.example.com',
      email: USER_B.email,
      subject: 'idp-sub-bob-secret',
      lastLoginAt: new Date('2026-02-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];

  const TEAM_MEMBERS = [
    { id: 'ctmA0000001', userId: USER_A.id, role: 'MEMBER', team: TEAM },
    { id: 'ctmB0000002', userId: USER_B.id, role: 'MEMBER', team: TEAM },
  ];

  const INCIDENTS = [
    {
      id: 'cincA0000001',
      assigneeId: USER_A.id,
      title: 'Alice-assigned outage',
      status: 'RESOLVED',
      urgency: 'HIGH',
      priority: 'P2',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      acknowledgedAt: null,
      resolvedAt: null,
      service: SERVICE,
    },
    {
      id: 'cincB0000002',
      assigneeId: USER_B.id,
      title: 'Bob-assigned outage — must not appear in A export',
      status: 'RESOLVED',
      urgency: 'HIGH',
      priority: 'P3',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      acknowledgedAt: null,
      resolvedAt: null,
      service: SERVICE,
    },
  ];

  const INCIDENT_NOTES = [
    {
      id: 'cnoteA000001',
      userId: USER_A.id,
      incidentId: INCIDENTS[0].id,
      content: 'Alice note content',
      createdAt: new Date(),
    },
    {
      id: 'cnoteB000002',
      userId: USER_B.id,
      incidentId: INCIDENTS[1].id,
      content: 'Bob note content — must not appear in A export',
      createdAt: new Date(),
    },
  ];

  const ON_CALL_SHIFTS = [
    {
      id: 'cshiftA00001',
      userId: USER_A.id,
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-02T00:00:00.000Z'),
      schedule: SCHEDULE,
    },
    {
      id: 'cshiftB00002',
      userId: USER_B.id,
      start: new Date('2026-04-01T00:00:00.000Z'),
      end: new Date('2026-04-02T00:00:00.000Z'),
      schedule: SCHEDULE,
    },
  ];

  const NOTIFICATIONS = [
    {
      id: 'cnotifA00001',
      userId: USER_A.id,
      incidentId: INCIDENTS[0].id,
      channel: 'EMAIL',
      status: 'DELIVERED',
      category: 'INCIDENT',
      scheduledAt: new Date(),
      sentAt: new Date(),
      deliveredAt: new Date(),
      failedAt: null,
      payloadEncrypted: 'encrypted-blob-a-must-never-leak',
      recipientHash: 'hash-of-alice-contact-must-never-leak',
      deliveryKey: 'delivery-key-a-must-never-leak',
      claimToken: 'claim-token-a-must-never-leak',
    },
    {
      id: 'cnotifB00002',
      userId: USER_B.id,
      incidentId: INCIDENTS[1].id,
      channel: 'EMAIL',
      status: 'DELIVERED',
      category: 'INCIDENT',
      scheduledAt: new Date(),
      sentAt: new Date(),
      deliveredAt: new Date(),
      failedAt: null,
      payloadEncrypted: 'encrypted-blob-b-must-never-leak',
      recipientHash: 'hash-of-bob-contact-must-never-leak',
      deliveryKey: 'delivery-key-b-must-never-leak',
      claimToken: 'claim-token-b-must-never-leak',
    },
  ];

  const AUDIT_EVENTS = [
    {
      id: 'caudA0000001',
      actorId: USER_A.id,
      entityType: 'USER',
      entityId: USER_A.id,
      action: 'user.login',
      createdAt: new Date(),
    },
    {
      id: 'caudB0000002',
      actorId: USER_B.id,
      entityType: 'USER',
      entityId: USER_B.id,
      action: 'user.login',
      createdAt: new Date(),
    },
  ];

  const OVERRIDES: Row[] = [];

  const mockPrisma = {
    user: { findUnique: makeFindUnique([USER_A, USER_B]) },
    oidcIdentity: { findMany: makeFindMany(OIDC_IDENTITIES) },
    teamMember: { findMany: makeFindMany(TEAM_MEMBERS) },
    incident: { findMany: makeFindMany(INCIDENTS) },
    incidentNote: { findMany: makeFindMany(INCIDENT_NOTES) },
    onCallShift: { findMany: makeFindMany(ON_CALL_SHIFTS) },
    onCallOverride: { findMany: makeFindMany(OVERRIDES) },
    notification: { findMany: makeFindMany(NOTIFICATIONS), count: makeCount(NOTIFICATIONS) },
    auditLog: { findMany: makeFindMany(AUDIT_EVENTS), count: makeCount(AUDIT_EVENTS) },
  };

  return { USER_A, USER_B, mockPrisma };
});

vi.mock('@/lib/prisma', () => ({ default: fixtures.mockPrisma }));

import JSZip from 'jszip';
import { generateSubjectExport } from '@/lib/privacy/export/exporter';

const { USER_A, USER_B } = fixtures;

async function unzipToText(
  buffer: Buffer
): Promise<{ files: Record<string, string>; combined: string }> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = await Promise.all(
    Object.entries(zip.files).map(
      async ([name, entry]) => [name, await entry.async('text')] as const
    )
  );
  const files: Record<string, string> = Object.fromEntries(entries);
  return { files, combined: Object.values(files).join('\n') };
}

const FORBIDDEN_STRINGS = [
  // Bob's identifying data must never appear in Alice's export.
  USER_B.email,
  USER_B.id,
  USER_B.phoneNumber,
  USER_B.name,
  'Bob-assigned outage',
  'Bob note content',
  // Security credentials must never appear in ANY export.
  USER_A.passwordHash,
  USER_B.passwordHash,
  'encrypted-blob-a-must-never-leak',
  'encrypted-blob-b-must-never-leak',
  'hash-of-alice-contact-must-never-leak',
  'hash-of-bob-contact-must-never-leak',
  'delivery-key-a-must-never-leak',
  'delivery-key-b-must-never-leak',
  'claim-token-a-must-never-leak',
  'claim-token-b-must-never-leak',
  'idp-sub-alice-secret',
  'idp-sub-bob-secret',
];

describe('generateSubjectExport leakage protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports A's own data without leaking B's data or any secrets", async () => {
    const generated = await generateSubjectExport({
      requestId: 'creq00000001',
      subjectType: 'USER',
      subjectId: USER_A.id,
    });

    const { files, combined } = await unzipToText(generated.buffer);

    // Sanity: this is really Alice's export.
    expect(combined).toContain(USER_A.email);
    expect(combined).toContain('Alice-assigned outage');
    expect(files['manifest.json']).toContain('creq00000001');

    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(combined).not.toContain(forbidden);
    }
  });

  it("exports B's own data without leaking A's data or any secrets", async () => {
    const generated = await generateSubjectExport({
      requestId: 'creq00000002',
      subjectType: 'USER',
      subjectId: USER_B.id,
    });

    const { combined } = await unzipToText(generated.buffer);

    expect(combined).toContain(USER_B.email);
    expect(combined).toContain('Bob-assigned outage');

    // Now flip the assertion: A's identifying data must not appear in B's export.
    const aOnlyForbidden = [
      USER_A.email,
      USER_A.id,
      USER_A.phoneNumber,
      'Alice-assigned outage',
      'Alice note content',
      USER_A.passwordHash,
      USER_B.passwordHash,
      'encrypted-blob-a-must-never-leak',
      'encrypted-blob-b-must-never-leak',
    ];
    for (const forbidden of aOnlyForbidden) {
      expect(combined).not.toContain(forbidden);
    }
  });

  it('manifest.json documents security exclusions and never embeds subject content', async () => {
    const generated = await generateSubjectExport({
      requestId: 'creq00000003',
      subjectType: 'USER',
      subjectId: USER_A.id,
    });

    const { files } = await unzipToText(generated.buffer);
    const manifest = JSON.parse(files['manifest.json']);

    expect(manifest.securityExclusions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('password hashes'),
        expect.stringContaining('tokens'),
      ])
    );
    expect(manifest.subject).toEqual({ type: 'USER', id: USER_A.id });
  });

  it('rejects export generation for a non-USER subject type', async () => {
    await expect(
      generateSubjectExport({
        requestId: 'creq00000004',
        subjectType: 'STATUS_SUBSCRIBER',
        subjectId: 'sub-1',
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('marks the manifest PARTIAL and reports true totals when a domain is truncated', async () => {
    // Simulate a subject with far more notifications/audit events than were
    // actually exported: the database says there are more than we fetched.
    fixtures.mockPrisma.notification.count.mockResolvedValueOnce(50_000);
    fixtures.mockPrisma.auditLog.count.mockResolvedValueOnce(50_000);

    const generated = await generateSubjectExport({
      requestId: 'creq00000005',
      subjectType: 'USER',
      subjectId: USER_A.id,
    });

    const { files } = await unzipToText(generated.buffer);
    const manifest = JSON.parse(files['manifest.json']);
    const notifications = JSON.parse(files['notifications.json']);
    const auditEvents = JSON.parse(files['audit-events.json']);

    expect(manifest.completeness).toBe('PARTIAL');
    expect(manifest.domainSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'notifications', totalCount: 50_000, truncated: true }),
        expect.objectContaining({ domain: 'audit-events', totalCount: 50_000, truncated: true }),
      ])
    );
    // Every truncated file must be honest about it inline, not just in the manifest.
    expect(notifications.truncated).toBe(true);
    expect(notifications.totalCount).toBe(50_000);
    expect(auditEvents.truncated).toBe(true);
  });
});
