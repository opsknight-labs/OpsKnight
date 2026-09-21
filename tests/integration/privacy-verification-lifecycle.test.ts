import { readFile } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { transitionPrivacyRequest } from '@/lib/privacy/requests';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('privacy verification lifecycle (real PostgreSQL)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('persists verification evidence before allowing processing', async () => {
    const [actor, subject] = await Promise.all([
      createTestUser({ role: 'ADMIN', status: 'ACTIVE' }),
      createTestUser({ role: 'USER', status: 'ACTIVE' }),
    ]);
    const request = await testPrisma.privacyRequest.create({
      data: {
        subjectId: subject.id,
        requestType: 'ACCESS',
        requestedById: actor.id,
      },
    });

    await transitionPrivacyRequest(
      { requestId: request.id, toStatus: 'IDENTITY_VERIFICATION' },
      { id: actor.id }
    );
    await transitionPrivacyRequest(
      {
        requestId: request.id,
        toStatus: 'IN_REVIEW',
        verificationMethod: 'MANUAL_ID_DOCUMENT',
        verificationReference: 'case-123',
      },
      { id: actor.id }
    );
    await transitionPrivacyRequest(
      { requestId: request.id, toStatus: 'PROCESSING' },
      { id: actor.id }
    );

    const stored = await testPrisma.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(stored).toMatchObject({
      status: 'PROCESSING',
      verificationStatus: 'VERIFIED',
      verificationMethod: 'MANUAL_ID_DOCUMENT',
      verificationReference: 'case-123',
      verifiedById: actor.id,
    });
    expect(stored.verifiedAt).toBeInstanceOf(Date);
  });

  it('repairs pre-migration unverified work and requires explicit re-verification', async () => {
    const [actor, subject] = await Promise.all([
      createTestUser({ role: 'ADMIN', status: 'ACTIVE' }),
      createTestUser({ role: 'USER', status: 'ACTIVE' }),
    ]);
    const request = await testPrisma.privacyRequest.create({
      data: {
        subjectId: subject.id,
        requestType: 'ACCESS',
        status: 'PROCESSING',
        requestedById: actor.id,
      },
    });
    const migration = await readFile(
      'prisma/migrations/20260921000000_privacy_verification_evidence/migration.sql',
      'utf8'
    );
    const repair = migration.match(
      /-- BEGIN stranded privacy request repair\n([\s\S]*?)-- END stranded privacy request repair/
    )?.[1];
    expect(repair).toBeTruthy();

    await testPrisma.$executeRawUnsafe(repair!);

    const repaired = await testPrisma.privacyRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    expect(repaired.status).toBe('IDENTITY_VERIFICATION');
    expect(repaired.verificationStatus).toBe('PENDING');
    expect(repaired.verifiedAt).toBeNull();
    await expect(
      transitionPrivacyRequest({ requestId: request.id, toStatus: 'PROCESSING' }, { id: actor.id })
    ).rejects.toMatchObject({ code: 'PRIVACY_REQUEST_INVALID_TRANSITION' });
  });
});
