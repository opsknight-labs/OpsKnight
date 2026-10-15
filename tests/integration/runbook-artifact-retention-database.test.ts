import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testPrisma, resetDatabase, createTestUser } from '../helpers/test-db';
import { reconcileRunbooks } from '@/lib/runbooks/reconciler';
import { updateRunbookArtifactRetentionAction } from '@/app/(app)/runbooks/actions';
import { CAPABILITIES } from '@/lib/authorization';
const authority = vi.hoisted(() => ({ id: '', check: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ assertCapability: authority.check }));
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
suite('administrator evidence retention policy', () => {
  beforeEach(async () => {
    await resetDatabase();
    authority.id = (await createTestUser({ role: 'ADMIN' })).id;
    authority.check.mockReset().mockResolvedValue({ id: authority.id });
  });
  it('requires admin authority and deletion acknowledgement, audits the policy and purges only expired artifacts', async () => {
    const form = new FormData();
    form.set('days', '7');
    await expect(updateRunbookArtifactRetentionAction(form)).rejects.toThrow();
    expect(await testPrisma.systemSettings.findUnique({ where: { id: 'default' } })).toBeNull();
    form.set('confirm', 'on');
    authority.check.mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(updateRunbookArtifactRetentionAction(form)).rejects.toThrow('Unauthorized');
    expect(authority.check).toHaveBeenCalledWith(CAPABILITIES.ADMIN_MANAGE);
    form.set('days', '0');
    await expect(updateRunbookArtifactRetentionAction(form)).rejects.toThrow();
    form.set('days', '7');
    await updateRunbookArtifactRetentionAction(form);
    expect(
      await testPrisma.systemSettings.findUniqueOrThrow({ where: { id: 'default' } })
    ).toMatchObject({ runbookArtifactRetentionDays: 7 });
    const workflow = await testPrisma.runbook.create({
      data: { name: 'Retention evidence', slug: `retention-${crypto.randomUUID()}` },
    });
    const version = await testPrisma.runbookVersion.create({
      data: {
        runbookId: workflow.id,
        version: 1,
        definition: { steps: [] },
        checksum: 'a'.repeat(64),
      },
    });
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: workflow.id,
        runbookVersionId: version.id,
        status: 'SUCCEEDED',
        definitionChecksum: version.checksum,
        deadlineAt: new Date(),
        steps: {
          create: {
            stepKey: 'diagnose',
            name: 'Diagnostics',
            type: 'LINUX_DIAGNOSTICS',
            sequence: 0,
            status: 'SUCCEEDED',
            attempts: {
              create: {
                attemptNumber: 1,
                status: 'SUCCEEDED',
                artifacts: {
                  create: [1, 10].map(days => ({
                    sizeBytes: 1,
                    sha256: 'b'.repeat(64),
                    content: Buffer.from('x'),
                    createdAt: new Date(Date.now() - days * 86_400_000),
                  })),
                },
              },
            },
          },
        },
      },
    });
    expect(await testPrisma.runbookArtifact.count()).toBe(2);
    await reconcileRunbooks(10);
    expect(await testPrisma.runbookArtifact.count()).toBe(1);
    expect(
      await testPrisma.runbookExecution.findUnique({ where: { id: execution.id } })
    ).not.toBeNull();
    const audit = await testPrisma.auditLog.findFirst({
      where: { action: 'runbook.artifact_retention.updated' },
    });
    expect(audit).toMatchObject({ actorId: authority.id });
  });
});
