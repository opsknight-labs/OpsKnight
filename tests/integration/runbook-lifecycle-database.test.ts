import { describe, expect, it } from 'vitest';
import {
  createRunbook,
  publishDraftVersion,
  updateRunbookMetadata,
  updateDraftVersion,
  cloneVersionToDraft,
  archiveRunbook,
} from '@/lib/runbooks/versioning';
import {
  deleteRunbook,
  restoreRunbook,
  duplicateRunbook,
  buildRunbookLibraryWhere,
} from '@/lib/runbooks/lifecycle';
import {
  createServiceBinding,
  replaceBindingTrigger,
} from '@/lib/runbooks/bindings';
import { startRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  RunbookArchivedError,
  RunbookCannotDeleteError,
} from '@/lib/runbooks/errors';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('Runbook Lifecycle PostgreSQL Certification Tests', () => {
  it('certifies concurrent publish-vs-delete race protection', async () => {
    const actor = await createTestUser();
    const slug = `race-pub-del-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Concurrent Race Runbook',
        slug,
        description: 'Testing concurrency race',
      },
      actor.id
    );

    const draftId = runbook.draftVersionId!;

    // Concurrently trigger publish and safe delete
    const [publishResult, deleteResult] = await Promise.allSettled([
      publishDraftVersion(draftId, actor.id),
      deleteRunbook(runbook.id, actor.id, slug),
    ]);

    // Safety property: Either publish won and delete was blocked, or delete won and publish was blocked
    if (deleteResult.status === 'fulfilled') {
      expect(publishResult.status).toBe('rejected');
      const record = await testPrisma.runbook.findUnique({ where: { id: runbook.id } });
      expect(record).toBeNull();
    } else {
      expect(deleteResult.status).toBe('rejected');
      const err = (deleteResult as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(RunbookCannotDeleteError);

      const record = await testPrisma.runbook.findUnique({
        where: { id: runbook.id },
        include: { versions: true },
      });
      expect(record).not.toBeNull();
      expect(record?.publishedVersionId).not.toBeNull();
    }
  });

  it('certifies concurrent bind-vs-delete race protection', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Lifecycle Binding Target');
    const slug = `race-bind-del-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Concurrent Binding Runbook',
        slug,
        description: 'Testing concurrency with service binding',
      },
      actor.id
    );

    // Concurrently attach a service binding and attempt delete
    const [bindResult, deleteResult] = await Promise.allSettled([
      testPrisma.serviceRunbookBinding.create({
        data: {
          runbookId: runbook.id,
          serviceId: service.id,
          mode: 'MANUAL',
          enabled: true,
          createdById: actor.id,
        },
      }),
      deleteRunbook(runbook.id, actor.id, slug),
    ]);

    // Safety property: Strict mutual exclusion
    if (deleteResult.status === 'fulfilled') {
      expect(bindResult.status).toBe('rejected');
      const record = await testPrisma.runbook.findUnique({ where: { id: runbook.id } });
      expect(record).toBeNull();
      const binding = await testPrisma.serviceRunbookBinding.findFirst({
        where: { runbookId: runbook.id },
      });
      expect(binding).toBeNull();
    } else {
      expect(bindResult.status).toBe('fulfilled');
      expect(deleteResult.status).toBe('rejected');
      const err = (deleteResult as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(RunbookCannotDeleteError);
      const record = await testPrisma.runbook.findUnique({
        where: { id: runbook.id },
        include: { bindings: true },
      });
      expect(record).not.toBeNull();
      expect(record?.bindings.length).toBeGreaterThan(0);
    }
  });

  it('certifies concurrent archive-vs-publish race protection via exclusive row locking', async () => {
    const actor = await createTestUser();
    const slug = `race-arch-pub-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Archive vs Publish Race',
        slug,
        description: 'Testing archive vs publish serialization',
      },
      actor.id
    );

    const draftId = runbook.draftVersionId!;

    // Concurrently trigger archive and publish
    const [archiveResult, publishResult] = await Promise.allSettled([
      archiveRunbook(runbook.id, actor.id),
      publishDraftVersion(draftId, actor.id),
    ]);

    // Archive always succeeds
    expect(archiveResult.status).toBe('fulfilled');

    const record = await testPrisma.runbook.findUnique({
      where: { id: runbook.id },
    });
    expect(record).not.toBeNull();
    expect(record?.archivedAt).not.toBeNull();

    // Mutual exclusion:
    // If archive won the lock first, publish MUST have rejected with RunbookArchivedError,
    // and publishedVersionId MUST remain null.
    // If publish won the lock first, publish succeeded and then archive archived it.
    if (publishResult.status === 'rejected') {
      const err = (publishResult as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(RunbookArchivedError);
      expect(record?.publishedVersionId).toBeNull();
    } else {
      expect(publishResult.status).toBe('fulfilled');
      expect(record?.publishedVersionId).toBe(draftId);
    }
  });

  it('certifies concurrent archive-vs-draft-edit race protection', async () => {
    const actor = await createTestUser();
    const slug = `race-arch-edit-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Archive vs Edit Race',
        slug,
        description: 'Testing archive vs draft edit serialization',
      },
      actor.id
    );

    const draftId = runbook.draftVersionId!;

    // Concurrently trigger archive and draft update
    const [archiveResult, editResult] = await Promise.allSettled([
      archiveRunbook(runbook.id, actor.id),
      updateDraftVersion(
        draftId,
        {
          definition: {
            description: 'concurrent modification',
            steps: [{ key: 'step_concurrent', name: 'Concurrent Step', type: 'MANUAL', riskClass: 'READ_ONLY' }],
          },
          expectedDraftRevision: 0,
        },
        actor.id
      ),
    ]);

    expect(archiveResult.status).toBe('fulfilled');

    const record = await testPrisma.runbook.findUnique({
      where: { id: runbook.id },
    });
    expect(record?.archivedAt).not.toBeNull();

    if (editResult.status === 'rejected') {
      const err = (editResult as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(RunbookArchivedError);
    } else {
      expect(editResult.status).toBe('fulfilled');
    }
  });

  it('certifies concurrent archive-vs-binding-create race protection', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Archive Race Service');
    const slug = `race-arch-bind-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Archive vs Binding Race',
        slug,
        description: 'Testing archive vs service binding serialization',
      },
      actor.id
    );

    // Publish first so runbook has an active published version
    await publishDraftVersion(runbook.draftVersionId!, actor.id);

    // Concurrently trigger archive and createServiceBinding
    const [archiveResult] = await Promise.allSettled([
      archiveRunbook(runbook.id, actor.id),
      createServiceBinding(
        service.id,
        {
          runbookId: runbook.id,
          mode: 'MANUAL',
          versionStrategy: 'LATEST_PUBLISHED',
          enabled: true,
          inputValues: {},
        },
        actor.id
      ),
    ]);

    expect(archiveResult.status).toBe('fulfilled');

    // Invariant: An active binding MUST NEVER be left enabled on an archived runbook!
    const bindings = await testPrisma.serviceRunbookBinding.findMany({
      where: { runbookId: runbook.id },
    });
    expect(bindings.every(b => !b.enabled)).toBe(true);
  });

  it('certifies replaceBindingTrigger rejects on archived runbook', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Trigger Test Service');
    const slug = `trigger-archived-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Trigger Guard Runbook',
        slug,
        description: 'Testing trigger configuration guard',
      },
      actor.id
    );

    await publishDraftVersion(runbook.draftVersionId!, actor.id);
    const binding = await createServiceBinding(
      service.id,
      {
        runbookId: runbook.id,
        mode: 'MANUAL',
        versionStrategy: 'LATEST_PUBLISHED',
        enabled: true,
        inputValues: {},
      },
      actor.id
    );

    // Archive the runbook
    await archiveRunbook(runbook.id, actor.id);

    // Attempting to configure triggers on an archived runbook MUST reject with RunbookArchivedError
    await expect(
      replaceBindingTrigger(
        service.id,
        binding.id,
        {
          event: 'INCIDENT_CREATED',
          conditionLogic: 'AND',
          enabled: true,
          conditions: [
            {
              field: 'incident.priority',
              operator: 'EQUALS',
              value: 'P1',
              sequence: 0,
            },
          ],
        },
        actor.id
      )
    ).rejects.toThrow(RunbookArchivedError);
  });

  it('certifies duplicateRunbook safely truncates long names to adhere to schema limit', async () => {
    const actor = await createTestUser();
    const longName = 'A'.repeat(200);
    const slug = `dup-len-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: longName,
        slug,
        description: 'Testing name length truncation during duplicate',
      },
      actor.id
    );

    const duplicated = await duplicateRunbook(runbook.id, actor.id);
    expect(duplicated.name.length).toBeLessThanOrEqual(200);
    expect(duplicated.name).toBe(`${'A'.repeat(193)} (Copy)`);
  });

  it('certifies concurrent archive-vs-execution-start race protection via FOR SHARE locking', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Execution Target Service');
    const slug = `race-arch-exec-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Archive vs Execution Race',
        slug,
        description: 'Testing archive vs execution serialization',
      },
      actor.id
    );

    await publishDraftVersion(runbook.draftVersionId!, actor.id);
    const binding = await createServiceBinding(
      service.id,
      {
        runbookId: runbook.id,
        mode: 'MANUAL',
        versionStrategy: 'LATEST_PUBLISHED',
        enabled: true,
        inputValues: {},
      },
      actor.id
    );

    // Concurrently trigger archive and startRunbookExecution
    const [archiveResult, execResult] = await Promise.allSettled([
      archiveRunbook(runbook.id, actor.id),
      startRunbookExecution({
        runbookId: runbook.id,
        serviceId: service.id,
        bindingId: binding.id,
        triggeredByUserId: actor.id,
      }),
    ]);

    expect(archiveResult.status).toBe('fulfilled');

    // If execution won the lock before archive, it succeeded.
    // If archive won the lock first, execution was blocked and rejected.
    if (execResult.status === 'rejected') {
      const err = (execResult as PromiseRejectedResult).reason;
      expect(
        err instanceof RunbookArchivedError ||
        (err instanceof Error && err.message.includes('archived'))
      ).toBe(true);
    } else {
      expect(execResult.status).toBe('fulfilled');
    }

    // After archive, any subsequent execution MUST be rejected
    await expect(
      startRunbookExecution({
        runbookId: runbook.id,
        serviceId: service.id,
        bindingId: binding.id,
        triggeredByUserId: actor.id,
      })
    ).rejects.toThrow();
  });

  it('certifies archiveRunbook transitions outstanding suggestions to DISMISSED', async () => {
    const actor = await createTestUser();
    const service = await createTestService('Suggestion Dismiss Service');
    const slug = `arch-dismiss-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Suggestion Dismissal Runbook',
        slug,
        description: 'Verifying suggestions are dismissed on archive',
      },
      actor.id
    );

    await publishDraftVersion(runbook.draftVersionId!, actor.id);
    const binding = await createServiceBinding(
      service.id,
      {
        runbookId: runbook.id,
        mode: 'SUGGESTED',
        versionStrategy: 'LATEST_PUBLISHED',
        enabled: true,
        inputValues: {},
      },
      actor.id
    );

    // Create an incident and trigger to attach a suggestion
    const incident = await createTestIncident('Incident for Suggestion', service.id);

    const trigger = await replaceBindingTrigger(
      service.id,
      binding.id,
      {
        event: 'INCIDENT_CREATED',
        conditionLogic: 'AND',
        enabled: true,
        conditions: [
          {
            field: 'incident.priority',
            operator: 'EQUALS',
            value: 'P1',
            sequence: 0,
          },
        ],
      },
      actor.id
    );

    const suggestion = await testPrisma.runbookSuggestion.create({
      data: {
        incidentId: incident.id,
        bindingId: binding.id,
        runbookVersionId: runbook.draftVersionId!,
        triggerId: trigger.id,
        sourceEventId: 'evt_1',
        fingerprint: `sug-${crypto.randomUUID()}`,
        state: 'SUGGESTED',
      },
    });

    // Archive the runbook
    await archiveRunbook(runbook.id, actor.id);

    // The suggestion must now be DISMISSED with dismissedAt set
    const afterArchive = await testPrisma.runbookSuggestion.findUnique({
      where: { id: suggestion.id },
    });
    expect(afterArchive?.state).toBe('DISMISSED');
    expect(afterArchive?.dismissedAt).not.toBeNull();
  });

  it('certifies foreign key protection on executions preventing hard delete', async () => {
    const actor = await createTestUser();
    const slug = `exec-safety-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Execution Protected Runbook',
        slug,
        description: 'Testing onDelete Restrict enforcement',
      },
      actor.id
    );

    // Create execution record attached to runbook
    await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: runbook.draftVersionId!,
        triggerFingerprint: `fp-${crypto.randomUUID()}`,
        status: 'SUCCEEDED',
        deadlineAt: new Date(Date.now() + 3600_000),
        definitionChecksum: 'dummy-checksum',
        triggeredByUserId: actor.id,
      },
    });

    // Domain safe-delete MUST reject
    await expect(deleteRunbook(runbook.id, actor.id, slug)).rejects.toThrow(
      RunbookCannotDeleteError
    );

    // Direct database deletion MUST be rejected by foreign key constraint (onDelete: Restrict)
    await expect(
      testPrisma.runbook.delete({ where: { id: runbook.id } })
    ).rejects.toThrow();
  });

  it('certifies transaction rollback on delete rejection', async () => {
    const actor = await createTestUser();
    const slug = `rollback-test-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Rollback Test Runbook',
        slug,
        description: 'Verifying atomic rollback',
      },
      actor.id
    );

    // Provide incorrect confirmation text to force rejection
    await expect(
      deleteRunbook(runbook.id, actor.id, 'incorrect-confirmation')
    ).rejects.toThrow(RunbookCannotDeleteError);

    // Verify all rows remain completely untouched
    const after = await testPrisma.runbook.findUnique({
      where: { id: runbook.id },
      include: { versions: true },
    });
    expect(after).not.toBeNull();
    expect(after?.draftVersionId).toBe(runbook.draftVersionId);
    expect(after?.versions.length).toBe(1);
  });

  it('certifies server-side archived mutation invariants across all authoring paths', async () => {
    const actor = await createTestUser();
    const slug = `archived-guards-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      {
        name: 'Archived Mutation Runbook',
        slug,
        description: 'Verifying archived mutations are blocked',
      },
      actor.id
    );

    const draftId = runbook.draftVersionId!;

    // Archive the runbook
    await archiveRunbook(runbook.id, actor.id);

    const archivedRecord = await testPrisma.runbook.findUnique({
      where: { id: runbook.id },
    });
    expect(archivedRecord?.archivedAt).not.toBeNull();

    // 1. updateRunbookMetadata MUST reject
    await expect(
      updateRunbookMetadata(runbook.id, { name: 'Attempted Renaming' }, actor.id)
    ).rejects.toThrow(RunbookArchivedError);

    // 2. updateDraftVersion MUST reject
    await expect(
      updateDraftVersion(
        draftId,
        {
          definition: {
            description: 'mutated',
            steps: [{ key: 'step_1', name: 'Step 1', type: 'MANUAL', riskClass: 'READ_ONLY' }],
          },
          expectedDraftRevision: 0,
        },
        actor.id
      )
    ).rejects.toThrow(RunbookArchivedError);

    // 3. publishDraftVersion MUST reject
    await expect(
      publishDraftVersion(draftId, actor.id)
    ).rejects.toThrow(RunbookArchivedError);

    // 4. cloneVersionToDraft MUST reject
    await expect(
      cloneVersionToDraft(draftId, actor.id)
    ).rejects.toThrow(RunbookArchivedError);

    // Confirm database state was unchanged by the rejected mutations
    const verified = await testPrisma.runbook.findUnique({
      where: { id: runbook.id },
      include: { versions: true },
    });
    expect(verified?.name).toBe('Archived Mutation Runbook');
    expect(verified?.publishedVersionId).toBeNull();
    expect(verified?.versions.length).toBe(1);
  });

  it('certifies archive and restore binding safety invariants', async () => {
    const actor = await createTestUser();
    const service1 = await createTestService('Service 1');
    const service2 = await createTestService('Service 2');
    const slug = `binding-safety-${crypto.randomUUID().slice(0, 8)}`;

    const runbook = await createRunbook(
      {
        name: 'Binding Invariant Runbook',
        slug,
        description: 'Verifying all bindings remain disabled on restore',
      },
      actor.id
    );

    // Create MANUAL and AUTOMATIC bindings that are enabled
    await testPrisma.serviceRunbookBinding.createMany({
      data: [
        {
          runbookId: runbook.id,
          serviceId: service1.id,
          mode: 'MANUAL',
          enabled: true,
          createdById: actor.id,
        },
        {
          runbookId: runbook.id,
          serviceId: service2.id,
          mode: 'AUTOMATIC',
          enabled: true,
          createdById: actor.id,
        },
      ],
    });

    // 1. Archive runbook
    await archiveRunbook(runbook.id, actor.id);

    // Invariant 1: Archive disables ALL bindings
    const bindingsAfterArchive = await testPrisma.serviceRunbookBinding.findMany({
      where: { runbookId: runbook.id },
    });
    expect(bindingsAfterArchive.every(b => !b.enabled)).toBe(true);

    // 2. Restore runbook
    await restoreRunbook(runbook.id, actor.id);

    // Invariant 2: Restoration leaves ALL bindings disabled for safety
    const bindingsAfterRestore = await testPrisma.serviceRunbookBinding.findMany({
      where: { runbookId: runbook.id },
    });
    expect(bindingsAfterRestore.length).toBe(2);
    expect(bindingsAfterRestore.every(b => !b.enabled)).toBe(true);
  });

  it('certifies library query builder segregation between active and archived views', async () => {
    const actor = await createTestUser();
    const activeSlug = `active-${crypto.randomUUID().slice(0, 8)}`;
    const archivedSlug = `archived-${crypto.randomUUID().slice(0, 8)}`;

    const activeRunbook = await createRunbook(
      { name: 'Active Library Test', slug: activeSlug, description: 'Active' },
      actor.id
    );
    const archivedRunbook = await createRunbook(
      { name: 'Archived Library Test', slug: archivedSlug, description: 'Archived' },
      actor.id
    );
    await archiveRunbook(archivedRunbook.id, actor.id);

    // Default active query
    const activeWhere = buildRunbookLibraryWhere({ page: 1, pageSize: 50 });
    const activeList = await testPrisma.runbook.findMany({
      where: { AND: [activeWhere, { id: { in: [activeRunbook.id, archivedRunbook.id] } }] },
    });
    expect(activeList.map(r => r.id)).toEqual([activeRunbook.id]);

    // Archived tab query
    const archivedWhere = buildRunbookLibraryWhere({ tab: 'archived', page: 1, pageSize: 50 });
    const archivedList = await testPrisma.runbook.findMany({
      where: { AND: [archivedWhere, { id: { in: [activeRunbook.id, archivedRunbook.id] } }] },
    });
    expect(archivedList.map(r => r.id)).toEqual([archivedRunbook.id]);
  });

  it('certifies audit logging persistence across all lifecycle operations', async () => {
    const actor = await createTestUser();
    const slug = `audit-cert-${crypto.randomUUID().slice(0, 8)}`;
    const runbook = await createRunbook(
      { name: 'Audit Cert Runbook', slug, description: 'Auditing lifecycle' },
      actor.id
    );

    // Duplicate
    const duplicated = await duplicateRunbook(runbook.id, actor.id);

    // Archive
    await archiveRunbook(runbook.id, actor.id);

    // Restore
    await restoreRunbook(runbook.id, actor.id);

    // Safe delete of the never-published duplicated draft
    await deleteRunbook(duplicated.id, actor.id, duplicated.slug);

    // Query persisted audit log records
    const auditEvents = await testPrisma.auditLog.findMany({
      where: {
        entityId: { in: [runbook.id, duplicated.id] },
      },
      select: { action: true, entityId: true },
    });

    const actions = auditEvents.map((e: { action: string }) => e.action);
    expect(actions).toContain('runbook.created');
    expect(actions).toContain('runbook.duplicated');
    expect(actions).toContain('runbook.archived');
    expect(actions).toContain('runbook.restored');
    expect(actions).toContain('runbook.deleted');
  });
});
