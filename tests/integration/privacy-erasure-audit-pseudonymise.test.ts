import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser, createTestService } from '../helpers/test-db';
import { pseudonymiseSubjectAuditRows } from '@/lib/privacy/erasure/audit-pseudonymise';
import { countOpenIncidentsMidEscalation } from '@/lib/escalation/step-cursor';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('erasure pseudonymises the subject audit rows (real database)', () => {
  it('clears the IP and scrubs identifiers inside details, once', async () => {
    const subject = await createTestUser({
      email: 'alice@example.com',
      name: 'Alice Wonder',
      role: 'RESPONDER',
    });
    const admin = await createTestUser({ email: 'admin@example.com', name: 'Root Admin' });

    const performed = await db.auditLog.create({
      data: {
        action: 'service.updated',
        entityType: 'SERVICE',
        entityId: 'svc-1',
        actorId: subject.id,
        actorEmail: 'alice@example.com',
        ip: '203.0.113.7',
        details: {
          note: 'Alice Wonder changed it from 203.0.113.7',
          nested: { who: 'alice@example.com', untouched: 'payments' },
          count: 3,
        },
      },
    });
    const keyed = await db.auditLog.create({
      data: {
        action: 'auth.login_failed',
        entityType: 'USER',
        entityId: 'alice@example.com',
        ip: '203.0.113.7',
        details: { attempted: 'alice@example.com' },
      },
    });
    const about = await db.auditLog.create({
      data: {
        action: 'user.role_changed',
        entityType: 'USER',
        entityId: subject.id,
        actorId: admin.id,
        ip: '198.51.100.9',
        details: { target: 'Alice Wonder', to: 'USER' },
      },
    });
    const unrelated = await db.auditLog.create({
      data: {
        action: 'service.updated',
        entityType: 'SERVICE',
        entityId: 'svc-2',
        actorId: admin.id,
        ip: '198.51.100.9',
        details: { note: 'nothing about anyone here' },
      },
    });

    const first = await db.$transaction(tx =>
      pseudonymiseSubjectAuditRows(tx, {
        id: subject.id,
        email: subject.email,
        name: subject.name,
        phoneNumber: null,
      })
    );
    expect(first.rows).toBe(3);
    expect(first.detailsScrubbed).toBe(3);

    const rows = new Map(
      (await db.auditLog.findMany()).map(row => [row.id, row] as const)
    );
    expect(rows.get(performed.id)?.ip).toBeNull();
    expect(rows.get(performed.id)?.details).toEqual({
      note: '[erased] changed it from [erased]',
      nested: { who: '[erased]', untouched: 'payments' },
      count: 3,
    });
    expect(rows.get(keyed.id)?.ip).toBeNull();
    expect(rows.get(keyed.id)?.details).toEqual({ attempted: '[erased]' });
    // An admin's action on the subject's account keeps the admin's IP, but the subject is named no more.
    expect(rows.get(about.id)?.ip).toBe('198.51.100.9');
    expect(rows.get(about.id)?.details).toEqual({ target: '[erased]', to: 'USER' });
    expect(rows.get(unrelated.id)?.ip).toBe('198.51.100.9');
    expect(rows.get(unrelated.id)?.details).toEqual({ note: 'nothing about anyone here' });

    const second = await db.$transaction(tx =>
      pseudonymiseSubjectAuditRows(tx, {
        id: subject.id,
        email: subject.email,
        name: subject.name,
        phoneNumber: null,
      })
    );
    expect(second.detailsScrubbed).toBe(0);
  });
});

describe('in-flight escalation count (real database)', () => {
  it('counts only open incidents that are mid-escalation on the policy', async () => {
    const policy = await db.escalationPolicy.create({ data: { name: 'Count policy' } });
    const service = await createTestService('Count service');
    await db.service.update({ where: { id: service.id }, data: { escalationPolicyId: policy.id } });
    const make = (status: 'OPEN' | 'RESOLVED', escalationStatus: 'ESCALATING' | 'COMPLETED') =>
      db.incident.create({
        data: {
          title: `${status}/${escalationStatus}`,
          serviceId: service.id,
          status,
          escalationStatus,
          currentEscalationStep: escalationStatus === 'ESCALATING' ? 1 : null,
        },
      });
    await make('OPEN', 'ESCALATING');
    await make('OPEN', 'ESCALATING');
    await make('RESOLVED', 'ESCALATING');
    await make('OPEN', 'COMPLETED');

    expect(await countOpenIncidentsMidEscalation(db, policy.id)).toBe(2);
  });
});
