import prisma from '@/lib/prisma';
import { getWarRoomProvider, listWarRoomProviders } from './registry';
import type { WarRoomIncidentEvent } from './provider';
import type { WarRoomProviderName } from './types';
import { warRoomIdempotencyKey } from './delivery';

async function adapterForRoom(warRoomId: string) {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { provider: true },
  });
  if (!room) throw new Error('War room was not found.');
  return getWarRoomProvider(room.provider as WarRoomProviderName);
}

export async function provisionWarRoom(
  warRoomId: string,
  provisioningToken: string,
  opts?: { reconciliationOnly?: boolean }
): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true } });
  // Normal create path must not race to READY once a durable close has won.
  // Reconciliation-only jobs are the explicit exception: they are marker-only
  // lookups for AMBIGUOUS/CLOSING that must NEVER POST a new room.
  if (!opts?.reconciliationOnly && room?.state === 'CLOSING') return;
  const adapter = await adapterForRoom(warRoomId);
  await adapter.provision(warRoomId, provisioningToken, opts);
}

export async function projectWarRoom(warRoomId: string, projectionVersion: number): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.project(warRoomId, projectionVersion);
}

export async function syncWarRoomParticipants(warRoomId: string): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.syncParticipants(warRoomId);
}

export async function settleWarRoomProjectionFailure(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.settleProjectionFailure(warRoomId, projectionVersion);
}

export async function reconcileWarRoom(warRoomId: string): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  if (!adapter.capabilities.reconciliation) return;
  await adapter.reconcile(warRoomId);
}

// ── Neutral lifecycle operations (routes must not branch on provider) ──

/** Ensure a marker-only reconciliation (WAR_ROOM_PROVISION) exists for this room. */
export async function ensureWarRoomReconciliationJob(warRoomId: string, provisioningToken: string): Promise<void> {
  // Token + flag aware dedupe: only suppress when an identical reconciliationOnly
  // job for this warRoomId+token already exists. A stale generic WAR_ROOM_PROVISION
  // or a different token must not swallow the durable handoff.
  const existing = await prisma.backgroundJob.findFirst({
    where: {
      type: 'WAR_ROOM_PROVISION',
      status: { in: ['PENDING', 'PROCESSING'] },
      AND: [
        { payload: { path: ['warRoomId'], equals: warRoomId } },
        { payload: { path: ['provisioningToken'], equals: provisioningToken } },
        { payload: { path: ['reconciliationOnly'], equals: true } },
      ],
    },
    select: { id: true },
  });
  if (existing) return;
  // Do NOT swallow enqueue failures: closeRequestedAt is durable intent;
  // a missing worker would strand the room. Let the caller retry.
  await prisma.backgroundJob.create({
    data: {
      type: 'WAR_ROOM_PROVISION',
      status: 'PENDING',
      scheduledAt: new Date(),
      maxAttempts: 6,
      payload: { warRoomId, provisioningToken, reconciliationOnly: true } as unknown as never,
    },
  });
}

const AMBIGUOUS_RECONCILIATION_WINDOW_MS = 15 * 60_000;

function isClosingReconciliationExpired(createAttemptedAt: Date | null): boolean {
  return createAttemptedAt != null && Date.now() >= createAttemptedAt.getTime() + AMBIGUOUS_RECONCILIATION_WINDOW_MS;
}

/** Repair helper: ensure a CLOSING room has its durable close jobs (crash-gap recovery). */
async function repairWarRoomCloseJobs(warRoomId: string, incidentId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { state: true, health: true, projectionVersion: true, lastProjectedVersion: true, createAttemptedAt: true, providerChannelId: true, provisioningToken: true },
  });
  if (!room || room.state !== 'CLOSING') return;
  const createUnresolved = room.createAttemptedAt != null && room.providerChannelId == null && room.provisioningToken != null;
  const reconciliationExpired = isClosingReconciliationExpired(room.createAttemptedAt);
  // CLOSING + unresolved create: identity not yet adopted. No terminal projection
  // should run until the provisioning reconcile resolves the external create —
  // unless the 15-min window has expired, in which case we must stop blocking
  // lifecycle and close locally as DEGRADED (unverified external outcome).
  if (createUnresolved && !reconciliationExpired) {
    await ensureWarRoomReconciliationJob(warRoomId, room.provisioningToken!);
  }
  if (createUnresolved && reconciliationExpired) {
    // Deadline authoritative: mark unverified and clear fencing token so
    // terminal close can proceed even though provider lookup never succeeded.
    // Persist drift debt so the low-frequency orphan lane can archive any
    // late-created provider channel idempotently without reopening lifecycle.
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, state: 'CLOSING', provisioningToken: room.provisioningToken! },
      data: {
        health: 'DEGRADED',
        lastErrorCode: 'RECONCILIATION_EXPIRED_UNVERIFIED',
        lastError: 'Reconciliation window expired with unverified external create outcome; closing locally as DEGRADED. Provider drift will be reconciled asynchronously.',
        provisioningToken: null,
        externalCleanupPending: true,
        externalCleanupReason: 'RECONCILIATION_EXPIRED_UNVERIFIED',
        externalCleanupLastAttemptAt: new Date(),
      },
    });
  }
  const existingClose = await prisma.backgroundJob.findFirst({
    where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
    select: { id: true, payload: true },
  });
  // If close job already exists, ensure a project job for the EXACT terminal version also exists
  // (except when create is unresolved and window still live — terminal projection would mark DEGRADED anyway).
  // Invariant: WAR_ROOM_CLOSE target=N → lastProjectedVersion>=N OR active WAR_ROOM_PROJECT(N) exists (exact N, not any).
  if (existingClose) {
    const liveUnresolved = createUnresolved && !reconciliationExpired;
    if (liveUnresolved) return;
    const rawPayload = existingClose.payload as unknown as { terminalProjectionVersion?: number } | null;
    const terminalVersion: number | null = typeof rawPayload?.terminalProjectionVersion === 'number' ? rawPayload.terminalProjectionVersion : null;
    const lastProjected = room.lastProjectedVersion ?? 0;
    if (terminalVersion != null) {
      if (lastProjected >= terminalVersion) return; // already satisfied
      const existingExactProj = await prisma.backgroundJob.findFirst({
        where: {
          type: 'WAR_ROOM_PROJECT',
          status: { in: ['PENDING', 'PROCESSING'] },
          AND: [
            { payload: { path: ['warRoomId'], equals: warRoomId } },
            { payload: { path: ['projectionVersion'], equals: terminalVersion } },
          ],
        },
        select: { id: true },
      });
      if (existingExactProj) return;
      await prisma.$transaction(async tx => {
        const fresh = await tx.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true } });
        if (!fresh || fresh.state !== 'CLOSING') return;
        const stillExact = await tx.backgroundJob.findFirst({
          where: {
            type: 'WAR_ROOM_PROJECT',
            status: { in: ['PENDING', 'PROCESSING'] },
            AND: [
              { payload: { path: ['warRoomId'], equals: warRoomId } },
              { payload: { path: ['projectionVersion'], equals: terminalVersion } },
            ],
          },
          select: { id: true },
        });
        if (stillExact) return;
        await tx.backgroundJob.create({
          data: {
            type: 'WAR_ROOM_PROJECT',
            status: 'PENDING',
            scheduledAt: new Date(),
            maxAttempts: 5,
            payload: { warRoomId, projectionVersion: terminalVersion } as unknown as never,
          },
        });
      });
      return;
    }
    // Legacy close without terminalProjectionVersion — fall back to any active project check
    const existingAnyProj = await prisma.backgroundJob.findFirst({
      where: { type: 'WAR_ROOM_PROJECT', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
      select: { id: true },
    });
    if (existingAnyProj) return;
    await prisma.$transaction(async tx => {
      const fresh = await tx.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true, projectionVersion: true } });
      if (!fresh || fresh.state !== 'CLOSING') return;
      await tx.backgroundJob.create({
        data: {
          type: 'WAR_ROOM_PROJECT',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 5,
          payload: { warRoomId, projectionVersion: fresh.projectionVersion } as unknown as never,
        },
      });
    });
    return;
  }
  // No close job — need to (re)create terminal projection + close atomically.
  // But if create is still unresolved and window is live, only ensure reconciliation.
  if (createUnresolved && !reconciliationExpired) {
    return;
  }
  await prisma.$transaction(async tx => {
    const fresh = await tx.incidentWarRoom.findUnique({
      where: { id: warRoomId },
      select: { state: true, projectionVersion: true, lastProjectedVersion: true },
    });
    if (!fresh || fresh.state !== 'CLOSING') return;
    const stillNoClose = await tx.backgroundJob.findFirst({
      where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
      select: { id: true },
    });
    if (stillNoClose) return;
    let terminal = fresh.projectionVersion;
    // If projection hasn't advanced past lastApplied, the original increment was lost — recreate it.
    if (fresh.projectionVersion === (fresh.lastProjectedVersion ?? 0)) {
      const inc = await tx.incidentWarRoom.updateMany({
        where: { id: warRoomId, state: 'CLOSING' },
        data: { projectionVersion: { increment: 1 } },
      });
      if (inc.count === 1) {
        const after = await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } });
        terminal = after.projectionVersion;
      }
    }
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROJECT',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: { warRoomId, projectionVersion: terminal } as unknown as never,
      },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_CLOSE',
        status: 'PENDING',
        scheduledAt: new Date(Date.now() + 2_000),
        maxAttempts: 5,
        payload: { warRoomId, incidentId, closeGeneration: Date.now(), terminalProjectionVersion: terminal } as unknown as never,
      },
    });
  });
}

/**
 * Neutral close lifecycle: READY|FAILED|PROVISIONING → CLOSING → terminal projection → provider archive → CLOSED/ARCHIVED.
 * AMBIGUOUS rooms persist a closeRequestedAt intent and trigger reconciliation
 * instead of immediate lifecycle transition — the close completes only after
 * external identity is adopted or proven absent.
 * Transient archive failures keep the room in CLOSING for queue retry; ambiguous is surfaced as DEGRADED.
 * Initiation is atomic: CLOSING + projection increment + both jobs in one serializable transaction.
 */
export async function closeWarRoomNeutral(input: { incidentId: string; warRoomId: string }): Promise<boolean> {
  const room = await prisma.incidentWarRoom.findFirst({ where: { id: input.warRoomId, incidentId: input.incidentId }, select: { id: true, provider: true, state: true, provisioningToken: true, createAttemptedAt: true, closeRequestedAt: true } });
  if (!room) return false;
  if (room.state === 'CLOSED' || room.state === 'ARCHIVED') return true; // idempotent no-op
  if (room.state === 'CLOSING') {
    await repairWarRoomCloseJobs(input.warRoomId, input.incidentId);
    return true;
  }
  // AMBIGUOUS: external create may have succeeded but OpsKnight doesn't yet
  // know the provider identity. Persist closeRequestedAt so the next successful
  // reconciliation (found → adopt as CLOSING) triggers the terminal close.
  if (room.state === 'AMBIGUOUS') {
    const now = new Date();
    await prisma.incidentWarRoom.updateMany({
      where: { id: input.warRoomId, state: 'AMBIGUOUS', closeRequestedAt: null },
      data: { closeRequestedAt: now },
    });
    // Ensure a marker-only reconcile is running so the external create outcome is resolved.
    if (room.provisioningToken && room.createAttemptedAt != null) {
      await ensureWarRoomReconciliationJob(input.warRoomId, room.provisioningToken);
    }
    return true;
  }
  const { runSerializableTransaction } = await import('@/lib/db-utils');
  const result = await runSerializableTransaction(async tx => {
    const existing = await tx.incidentWarRoom.findUnique({
      where: { id: input.warRoomId },
      select: { incidentId: true, provider: true, state: true, createAttemptedAt: true, provisioningToken: true },
    });
    if (!existing) return { initiated: false as const };
    if (existing.incidentId !== input.incidentId || existing.provider !== room.provider) return { initiated: false as const };
    if (!['READY', 'PROVISIONING', 'FAILED'].includes(existing.state)) return { initiated: false as const };

    // CLOSING with unresolved in-flight create must not have been raced before
    // we own CLOSING — let the winner's provisioning token handle the late
    // response. The data update below preserves provisioningToken when needed.

    const preserveProvisioningFence = existing.state === 'PROVISIONING' && existing.createAttemptedAt != null;
    const data: Record<string, unknown> = {
      state: 'CLOSING',
      closeRequestedAt: new Date(),
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
    };
    if (!preserveProvisioningFence) {
      (data as Record<string, unknown>).provisioningToken = null;
      (data as Record<string, unknown>).provisioningStartedAt = null;
    }
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: input.warRoomId, incidentId: input.incidentId, provider: room.provider as never, state: { in: ['READY', 'PROVISIONING', 'FAILED'] } },
      data: data as never,
    });
    if (changed.count !== 1) return { initiated: false as const };
    // Do not create terminal projection if the external create is still unresolved;
    // the provisioning reconcile needs to run first so the channel identity exists
    // before the terminal card is rendered. Otherwise the projector would just
    // mark DEGRADED and the close would orphan the late-created channel.
    if (preserveProvisioningFence) {
      // No terminal jobs yet — just install CLOSING + closeRequestedAt and
      // enqueue reconciliation. The adoptWarRoomChannel(CLOSING) path will
      // install the terminal jobs once the identity arrives.
      await tx.backgroundJob.create({
        data: {
          type: 'WAR_ROOM_PROVISION',
          status: 'PENDING',
          scheduledAt: new Date(),
          maxAttempts: 6,
          payload: { warRoomId: input.warRoomId, provisioningToken: existing.provisioningToken ?? room.provisioningToken, reconciliationOnly: true } as unknown as never,
        },
      });
      return { initiated: true as const, deferred: true as const } as { initiated: true; deferred: true };
    }
    // Increment projection in same tx so crash cannot leave CLOSING without terminal version.
    const projChanged = await tx.incidentWarRoom.updateMany({
      where: { id: input.warRoomId, state: 'CLOSING' },
      data: { projectionVersion: { increment: 1 } },
    });
    if (projChanged.count !== 1) return { initiated: false as const };
    const fresh = await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: input.warRoomId }, select: { projectionVersion: true } });
    const terminalProjectionVersion = fresh.projectionVersion;
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROJECT',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: { warRoomId: input.warRoomId, projectionVersion: terminalProjectionVersion } as unknown as never,
      },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_CLOSE',
        status: 'PENDING',
        scheduledAt: new Date(Date.now() + 2_000),
        maxAttempts: 5,
        payload: { warRoomId: input.warRoomId, incidentId: input.incidentId, closeGeneration: Date.now(), terminalProjectionVersion } as unknown as never,
      },
    });
    return { initiated: true as const, terminalProjectionVersion } as { initiated: true; terminalProjectionVersion: number };
  });
  return (result as { initiated: boolean }).initiated;
}

/** Close all war rooms for an incident via the neutral engine (resolve path). Idempotent per room. */
export async function closeIncidentWarRoomsNeutral(
  incidentId: string,
  opts?: { provider?: WarRoomProviderName }
): Promise<{ closed: number; skipped: number }> {
  const providerFilter = opts?.provider ? { provider: opts.provider as never } : {};
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, state: { in: ['READY', 'PROVISIONING', 'FAILED', 'CLOSING', 'AMBIGUOUS'] }, ...providerFilter },
    select: { id: true, provider: true, state: true },
  });
  let closed = 0;
  let skipped = 0;
  for (const room of rooms) {
    const ok = await closeWarRoomNeutral({ incidentId, warRoomId: room.id });
    if (ok) closed++;
    else skipped++;
  }
  return { closed, skipped };
}

/** Provider-scoped close: only rooms for the given provider are closed. Used by ARCHIVE deliveries. */
export async function closeProviderWarRoomsNeutral(
  incidentId: string,
  provider: WarRoomProviderName
): Promise<{ closed: number; skipped: number }> {
  return closeIncidentWarRoomsNeutral(incidentId, { provider });
}

/**
 * Called from the adoptWarRoomChannel(CLOSING) path — a late-arriving
 * provision response adopted the external identity after closeRequestedAt
 * was already set. Atomically queue terminal projection + WAR_ROOM_CLOSE
 * under closeRequestedAt's ownership.
 */
export async function ensureTerminalCloseJobsAfterClosingAdoption(warRoomId: string, incidentId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true, projectionVersion: true, closeRequestedAt: true } });
  if (!room || room.state !== 'CLOSING' || room.closeRequestedAt == null) return;
  const existing = await prisma.backgroundJob.findFirst({
    where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
    select: { id: true },
  });
  if (existing) return;
  await prisma.$transaction(async tx => {
    const fresh = await tx.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true, projectionVersion: true, closeRequestedAt: true } });
    if (!fresh || fresh.state !== 'CLOSING' || fresh.closeRequestedAt == null) return;
    const stillNoClose = await tx.backgroundJob.findFirst({
      where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
      select: { id: true },
    });
    if (stillNoClose) return;
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, state: 'CLOSING' },
      data: { projectionVersion: { increment: 1 } },
    });
    // If increment collides (e.g. another path incremented first), just read current.
    const withVersion = changed.count === 1
      ? await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } })
      : await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } });
    await tx.backgroundJob.create({
      data: { type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId, projectionVersion: withVersion.projectionVersion } as unknown as never },
    });
    await tx.backgroundJob.create({
      data: { type: 'WAR_ROOM_CLOSE', status: 'PENDING', scheduledAt: new Date(Date.now() + 2_000), maxAttempts: 5, payload: { warRoomId, incidentId, closeGeneration: Date.now(), terminalProjectionVersion: withVersion.projectionVersion } as unknown as never },
    });
  });
}

/** Finalizes a CLOSING room: waits for the terminal projection to settle, then provider archive, then CLOSED/ARCHIVED. Called by WAR_ROOM_CLOSE worker and WAR_ROOM_RECONCILE(close). */
export async function finalizeWarRoomCloseNeutral(warRoomId: string, incidentId?: string, expectedTerminalProjectionVersion?: number | null): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: {
      id: true,
      incidentId: true,
      provider: true,
      state: true,
      projectionVersion: true,
      lastProjectedVersion: true,
      projectionLeaseToken: true,
      projectionLeaseExpiresAt: true,
      health: true,
      lastErrorCode: true,
      createAttemptedAt: true,
      providerChannelId: true,
      provisioningToken: true,
    },
  });
  if (!room) return;
  if (room.state !== 'CLOSING') return;

  // Unresolved external create: CLOSING + createAttemptedAt && !providerChannelId
  // means the channel/card identity may yet arrive via the provisioning reconcile.
  // Terminalizing now would let adoption return FENCED (token cleared) and orphan
  // the external channel. Defer the close until identity is adopted or proven absent
  // — but only while the reconciliation window is still live. After 15 min we
  // must close locally as DEGRADED (unverified) and leave provider drift for
  // asynchronous cleanup; otherwise CLOSING would be held forever when
  // credentials are removed or the provider is persistently unavailable.
  const createUnresolved = room.createAttemptedAt != null && room.providerChannelId == null && room.provisioningToken != null;
  const reconciliationExpired = isClosingReconciliationExpired(room.createAttemptedAt);
  if (createUnresolved && reconciliationExpired) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, state: 'CLOSING', provisioningToken: room.provisioningToken! },
      data: {
        health: 'DEGRADED',
        lastErrorCode: 'RECONCILIATION_EXPIRED_UNVERIFIED',
        lastError: 'Reconciliation window expired with unverified external create outcome; closing locally as DEGRADED. Provider drift will be reconciled asynchronously.',
        provisioningToken: null,
        externalCleanupPending: true,
        externalCleanupReason: 'RECONCILIATION_EXPIRED_UNVERIFIED',
        externalCleanupLastAttemptAt: new Date(),
      },
    });
    // Engine-level expiry also persists debt even though no provider was consulted.
  }
  // Backfill debt for degraded-terminal closes that already settled locally
  // with providerChannelId == null and a RECONCILIATION_EXPIRED_* reason but
  // predated the externalCleanupPending column. The async orphan lane scans
  // pending=true, so ensure debt is wired even when this tick didn't create it.
  if (
    room.state === 'CLOSING' &&
    room.providerChannelId == null &&
    typeof room.lastErrorCode === 'string' &&
    room.lastErrorCode.startsWith('RECONCILIATION_EXPIRED_')
  ) {
    try {
      const freshDebt = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { externalCleanupPending: true, lastErrorCode: true } });
      if (freshDebt && !freshDebt.externalCleanupPending && typeof freshDebt.lastErrorCode === 'string' && freshDebt.lastErrorCode.startsWith('RECONCILIATION_EXPIRED_')) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: warRoomId, externalCleanupPending: false },
          data: { externalCleanupPending: true, externalCleanupReason: freshDebt.lastErrorCode, externalCleanupLastAttemptAt: new Date() },
        });
      }
    } catch {}
  }
  if (createUnresolved) {
    if (reconciliationExpired) {
      // Debt already wired above — fall through to local CLOSED/ARCHIVED and
      // let the async drift lane reclaim any provider orphan.
    } else {
      await ensureWarRoomReconciliationJob(warRoomId, room.provisioningToken!);
      const { WarRoomRetryableError } = await import('./errors');
      throw new WarRoomRetryableError('Unresolved external create outcome — waiting for provisioning reconciliation before terminal close.', 5000, true);
    }
  }

  const effectiveIncidentId = incidentId ?? room.incidentId;
  const adapter = getWarRoomProvider(room.provider as WarRoomProviderName);
  const canArchive = adapter.capabilities.archiveRoom;

  // Wait for the terminal projection captured at close initiation — never queue a new one on retry.
  // lastProjectedVersion advances only on successful provider apply (complete*Projection), so
  // projectionVersion alone (queued-at) + lease==null does NOT mean completed.
  if (expectedTerminalProjectionVersion != null) {
    const lastProjected = (room as { lastProjectedVersion?: number | null }).lastProjectedVersion ?? 0;
    if (lastProjected < expectedTerminalProjectionVersion) {
      const hasActiveProjection = room.projectionLeaseToken != null;
      if (hasActiveProjection) {
        const { WarRoomRetryableError } = await import('./errors');
        throw new WarRoomRetryableError('Terminal projection still in flight; retrying close after it settles.', 3000, true);
      }
      // Lease cleared but still behind — either projection job is still pending or it was terminally settled as DEGRADED.
      // If a WAR_ROOM_PROJECT job for the EXACT expected terminal version is still PENDING/PROCESSING, retry budget-neutral.
      // If no such version-specific job remains (exhausted / failed), fall through to degraded-close fallback.
      const hasPendingProjectJob = await prisma.backgroundJob.findFirst({
        where: {
          type: 'WAR_ROOM_PROJECT',
          status: { in: ['PENDING', 'PROCESSING'] },
          AND: [
            { payload: { path: ['warRoomId'], equals: warRoomId } },
            { payload: { path: ['projectionVersion'], equals: expectedTerminalProjectionVersion } },
          ],
        },
        select: { id: true },
      });
      if (hasPendingProjectJob) {
        const { WarRoomRetryableError } = await import('./errors');
        const msg =
          room.projectionVersion >= expectedTerminalProjectionVersion
            ? 'Waiting for terminal projection to be applied before archive.'
            : 'Waiting for terminal projection to reach target version before archive.';
        throw new WarRoomRetryableError(msg, 3000, true);
      }
      // Degraded fallback: terminal projection exhausted (or never scheduled) and lease cleared — proceed to close with DEGRADED audit.
      // We keep health DEGRADED so operator can see projection did not reach terminal version.
      if (room.health !== 'DEGRADED') {
        await prisma.incidentWarRoom.updateMany({
          where: { id: warRoomId, state: 'CLOSING' },
          data: { health: 'DEGRADED', lastErrorCode: 'CLOSE_PROJECTION_DEGRADED', lastError: `Closing with degraded terminal projection (lastProjected=${lastProjected}, expected=${expectedTerminalProjectionVersion}); archiving anyway.` },
        });
      }
      // Fall through to archive/close.
    }
  } else {
    const hasActiveProjection = room.projectionLeaseToken != null;
    if (hasActiveProjection) {
      const { WarRoomRetryableError } = await import('./errors');
      throw new WarRoomRetryableError('Terminal projection still in flight; retrying close after it settles.', 3000, true);
    }
  }

  if (canArchive && adapter.archive) {
    const result = await adapter.archive(warRoomId);
    if (!result.ok) {
      if (result.code === 'AMBIGUOUS_SIDE_EFFECT') {
        await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { health: 'DEGRADED', lastErrorCode: 'CLOSE_AMBIGUOUS', lastError: result.message } });
        const { WarRoomRetryableError } = await import('./errors');
        throw new WarRoomRetryableError(result.message, result.retryAfterMs, true);
      }
      if (result.code === 'RATE_LIMITED' || result.code === 'TRANSIENT') {
        const { WarRoomRetryableError } = await import('./errors');
        throw new WarRoomRetryableError(result.message, result.retryAfterMs);
      }
      if (result.code === 'NOT_FOUND' || result.code === 'ALREADY_EXISTS') {
        const { runSerializableTransaction } = await import('@/lib/db-utils');
        const cap = adapter.capabilities.archiveRoom;
        await runSerializableTransaction(async tx => {
          const { settleWarRoomClosed } = await import('./repository');
          await settleWarRoomClosed(tx, { incidentId: effectiveIncidentId, warRoomId, provider: room.provider });
          if (cap) {
            await tx.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { state: 'ARCHIVED', archivedAt: new Date() } });
          }
        });
        return;
      }
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { health: 'DEGRADED', lastErrorCode: result.code, lastError: result.message } });
      const { WarRoomRetryableError } = await import('./errors');
      throw new WarRoomRetryableError(result.message, result.retryAfterMs);
    }
    const { runSerializableTransaction } = await import('@/lib/db-utils');
    await runSerializableTransaction(async tx => {
      await tx.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { state: 'ARCHIVED', archivedAt: new Date(), closedAt: new Date(), provisioningToken: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
    });
    return;
  }

  const { runSerializableTransaction } = await import('@/lib/db-utils');
  const { settleWarRoomClosed } = await import('./repository');
  await runSerializableTransaction(tx => settleWarRoomClosed(tx, { incidentId: effectiveIncidentId, warRoomId, provider: room.provider }));
}

export async function requestWarRoomProjectionNeutral(warRoomId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const room = await tx.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { provider: true, state: true } });
    if (!room || !['READY', 'CLOSING'].includes(room.state)) return null;
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, state: { in: ['READY', 'CLOSING'] } },
      data: { projectionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const fresh = await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } });
    await tx.backgroundJob.create({
      data: { type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId, projectionVersion: fresh.projectionVersion } },
    });
    return fresh.projectionVersion;
  });
}

export async function abandonAmbiguousWarRoomCardNeutral(incidentId: string, warRoomId: string): Promise<{ abandoned: boolean; warning: string }> {
  const room = await prisma.incidentWarRoom.findFirst({ where: { id: warRoomId, incidentId, health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_CARD_CREATE' }, select: { id: true, provider: true } });
  if (!room) return { abandoned: false, warning: 'War room is not in an ambiguous card state.' };
  await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, lastErrorCode: 'AMBIGUOUS_CARD_CREATE' },
    data: { commandCreateAttemptedAt: null, commandMessageId: null, commandConversationId: null, health: 'HEALTHY', lastErrorCode: null, lastError: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null },
  });
  await requestWarRoomProjectionNeutral(warRoomId);
  const warning = room.provider === 'SLACK'
    ? 'Ambiguous Slack card abandoned. A duplicate card may still exist; delete it manually if so.'
    : 'Ambiguous card abandoned. A duplicate card may still exist in the Teams channel; delete it manually if so.';
  return { abandoned: true, warning };
}

/**
 * Low-frequency repair sweep for CLOSING rooms that lost their terminal jobs
 * (crash between CLOSING and job creation, or job table GC).
 *
 * Orphan-selective + fair: paginates over CLOSING in closeRequestedAt order and
 * only repairs rooms that are actually missing required jobs. The previous
 * `take:20` over all CLOSING starved an orphan at position 21 when the first
 * 20 already had healthy WAR_ROOM_CLOSE jobs — this scan continues until
 * `limit` orphans are repaired or the table is exhausted.
 *
 * Orphan criteria (per room, mirroring repairWarRoomCloseJobs):
 *  - CLOSING + unresolved create (createAttemptedAt && !providerChannelId && provisioningToken)
 *    and window live but no reconciliationOnly job → orphan
 *  - CLOSING + identity resolved and no active WAR_ROOM_CLOSE → orphan
 *  - CLOSING + WAR_ROOM_CLOSE exists but terminal version not yet satisfied
 *    (lastProjectedVersion < terminal) and no exact WAR_ROOM_PROJECT(terminal) → orphan
 */
async function isClosingOrphan(warRoomId: string): Promise<boolean> {
  const closeRow = await prisma.backgroundJob.findFirst({
    where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
    select: { payload: true },
  });
  if (!closeRow) return true; // missing close — orphan (or live-unresolved no-close, repairWarRoomCloseJobs will decide)
  const raw = closeRow.payload as unknown as { terminalProjectionVersion?: number } | null;
  const terminal = typeof raw?.terminalProjectionVersion === 'number' ? raw.terminalProjectionVersion : null;
  if (terminal == null) {
    // Legacy close without version — any active project suffices
    const anyProj = await prisma.backgroundJob.findFirst({
      where: { type: 'WAR_ROOM_PROJECT', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: warRoomId } },
      select: { id: true },
    });
    return !anyProj ? true : false; // if a project exists, may still need deeper check but treat as non-orphan for sweep
  }
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { lastProjectedVersion: true } });
  const lastProjected = room?.lastProjectedVersion ?? 0;
  if (lastProjected >= terminal) return false; // already satisfied
  const exactProj = await prisma.backgroundJob.findFirst({
    where: {
      type: 'WAR_ROOM_PROJECT',
      status: { in: ['PENDING', 'PROCESSING'] },
      AND: [
        { payload: { path: ['warRoomId'], equals: warRoomId } },
        { payload: { path: ['projectionVersion'], equals: terminal } },
      ],
    },
    select: { id: true },
  });
  return !exactProj;
}

async function isReconciliationOrphan(warRoomId: string): Promise<boolean> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { createAttemptedAt: true, providerChannelId: true, provisioningToken: true },
  });
  if (!room) return false;
  const createUnresolved = room.createAttemptedAt != null && room.providerChannelId == null && room.provisioningToken != null;
  const expired = isClosingReconciliationExpired(room.createAttemptedAt);
  if (!createUnresolved || expired) return false;
  const recon = await prisma.backgroundJob.findFirst({
    where: {
      type: 'WAR_ROOM_PROVISION',
      status: { in: ['PENDING', 'PROCESSING'] },
      AND: [
        { payload: { path: ['warRoomId'], equals: warRoomId } },
        { payload: { path: ['provisioningToken'], equals: room.provisioningToken! } },
        { payload: { path: ['reconciliationOnly'], equals: true } },
      ],
    },
    select: { id: true },
  });
  return !recon;
}

export async function repairOrphanedClosingWarRooms(limit = 20): Promise<{ checked: number; repaired: number }> {
  const cap = Math.max(1, Math.min(limit, 100));
  const pageSize = 50;
  const maxPages = 10;
  let cursor: string | undefined;
  let checked = 0;
  let repaired = 0;
  let pages = 0;

  while (repaired < cap && pages < maxPages) {
    const batch = await prisma.incidentWarRoom.findMany({
      where: { state: 'CLOSING' },
      orderBy: [{ closeRequestedAt: 'asc' }, { id: 'asc' }],
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, incidentId: true },
    });
    if (batch.length === 0) break;
    pages++;
    checked += batch.length;

    for (const room of batch) {
      if (repaired >= cap) break;
      // Determine if this specific room is an orphan before invoking repair
      const [closingOrphan, reconOrphan] = await Promise.all([isClosingOrphan(room.id), isReconciliationOrphan(room.id)]);
      if (!closingOrphan && !reconOrphan) continue;

      const beforeClose = await prisma.backgroundJob.findFirst({
        where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
        select: { id: true },
      });
      const beforeRecon = reconOrphan
        ? null
        : await prisma.backgroundJob.findFirst({
            where: {
              type: 'WAR_ROOM_PROVISION',
              status: { in: ['PENDING', 'PROCESSING'] },
              AND: [
                { payload: { path: ['warRoomId'], equals: room.id } },
                { payload: { path: ['reconciliationOnly'], equals: true } },
              ],
            },
            select: { id: true },
          });

      // Let failures propagate — the cron tick will retry next cycle.
      await repairWarRoomCloseJobs(room.id, room.incidentId);

      const afterClose = await prisma.backgroundJob.findFirst({
        where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
        select: { id: true },
      });
      const afterRecon = await prisma.backgroundJob.findFirst({
        where: {
          type: 'WAR_ROOM_PROVISION',
          status: { in: ['PENDING', 'PROCESSING'] },
          AND: [
            { payload: { path: ['warRoomId'], equals: room.id } },
            { payload: { path: ['reconciliationOnly'], equals: true } },
          ],
        },
        select: { id: true },
      });

      const closeRepaired = !beforeClose && !!afterClose;
      const reconRepaired = !beforeRecon && !!afterRecon;
      // Also count exact-version project repair as a repair event
      let projectRepaired = false;
      if (beforeClose && afterClose && !reconRepaired) {
        const closeRow = await prisma.backgroundJob.findFirst({
          where: { type: 'WAR_ROOM_CLOSE', status: { in: ['PENDING', 'PROCESSING'] }, payload: { path: ['warRoomId'], equals: room.id } },
          select: { payload: true },
        });
        const raw = closeRow?.payload as unknown as { terminalProjectionVersion?: number } | null;
        const terminal = typeof raw?.terminalProjectionVersion === 'number' ? raw.terminalProjectionVersion : null;
        if (terminal != null) {
          // If before we had no exact project and now we do, that is a repair
          // We already know isClosingOrphan was true, so after should have exact project
          const exactNow = await prisma.backgroundJob.findFirst({
            where: {
              type: 'WAR_ROOM_PROJECT',
              status: { in: ['PENDING', 'PROCESSING'] },
              AND: [
                { payload: { path: ['warRoomId'], equals: room.id } },
                { payload: { path: ['projectionVersion'], equals: terminal } },
              ],
            },
            select: { id: true },
          });
          if (exactNow) projectRepaired = true;
        }
      }

      if (closeRepaired || reconRepaired || projectRepaired) repaired++;
    }

    if (batch.length < pageSize) break;
    cursor = batch[batch.length - 1]!.id;
  }

  return { checked, repaired };
}

export async function handleIncidentWarRoomEvent(event: WarRoomIncidentEvent): Promise<void> {
  const idempotencyKey = event.idempotencyKey ?? warRoomIdempotencyKey(event as never);
  const tagged: WarRoomIncidentEvent = { ...event, idempotencyKey } as WarRoomIncidentEvent;
  const { ensureWarRoomDelivery } = await import('./delivery');
  const { scheduleJob } = await import('@/lib/jobs/queue');
  const incidentId = event.incidentId;
  const kind = event.kind;
  for (const adapter of listWarRoomProviders()) {
    const ensure = await ensureWarRoomDelivery({
      provider: adapter.provider,
      idempotencyKey,
      incidentId,
      kind,
      eventPayload: tagged,
    });
    if (!ensure.created && ensure.alreadyCompleted) continue;
    await scheduleJob(
      'WAR_ROOM_PROVIDER_EVENT',
      new Date(),
      { deliveryId: ensure.id } as unknown as Record<string, unknown>,
      5
    );
  }
}

/** Sweeps orphaned PENDING deliveries that lost their BackgroundJob (crash before schedule). */
export async function recoverOrphanedWarRoomDeliveries(): Promise<number> {
  const { findOrphanedWarRoomDeliveries } = await import('./delivery');
  const { scheduleJob } = await import('@/lib/jobs/queue');
  const orphans = await findOrphanedWarRoomDeliveries(50);
  let recovered = 0;
  for (const orphan of orphans) {
    try {
      await scheduleJob('WAR_ROOM_PROVIDER_EVENT', new Date(), { deliveryId: orphan.id } as unknown as Record<string, unknown>, 5);
      recovered++;
    } catch {}
  }
  return recovered;
}

export async function handleIncidentWarRoomProviderEvent(input: {
  deliveryId?: string;
  provider?: WarRoomProviderName;
  event?: WarRoomIncidentEvent;
  idempotencyKey?: string;
  // legacy job still passes provider/event/idempotencyKey
}): Promise<void> {
  const { claimWarRoomDelivery, claimWarRoomDeliveryById, completeWarRoomDelivery, releaseWarRoomDeliveryForRetry, validateDeliveryLease } = await import('./delivery');
  let deliveryId: string | null = input.deliveryId ?? null;
  let leaseToken: string | null = null;
  let resolvedProvider: WarRoomProviderName | null = (input.provider as WarRoomProviderName) ?? null;
  let resolvedEvent: WarRoomIncidentEvent | null = input.event ?? null;
  let resolvedIdempotencyKey: string | null = input.idempotencyKey ?? input.event?.idempotencyKey ?? null;

  // Resolve delivery by id when available (new durable contract)
  if (deliveryId) {
    const row = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, provider: true, idempotencyKey: true, eventPayload: true },
    });
    if (!row) throw new Error(`War-room delivery ${deliveryId} not found`);
    if (row.status === 'COMPLETED') return;
    if (row.status === 'FAILED') return;
    resolvedProvider = row.provider as WarRoomProviderName;
    resolvedIdempotencyKey = row.idempotencyKey;
    resolvedEvent = row.eventPayload as unknown as WarRoomIncidentEvent;
  } else {
    // Fallback for rolling deploy — resolve from provider+key
    const fallbackKey = resolvedIdempotencyKey ?? (resolvedEvent ? warRoomIdempotencyKey(resolvedEvent as never) : null);
    if (!resolvedProvider || !fallbackKey || !resolvedEvent) throw new Error('War-room provider event missing deliveryId');
    resolvedIdempotencyKey = fallbackKey;
    const existing = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: resolvedProvider as never, idempotencyKey: fallbackKey } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'COMPLETED') return;
    if (existing?.status === 'FAILED') return;
    if (!existing) {
      const { ensureWarRoomDelivery } = await import('./delivery');
      const created = await ensureWarRoomDelivery({ provider: resolvedProvider, idempotencyKey: fallbackKey, incidentId: resolvedEvent.incidentId, kind: resolvedEvent.kind, eventPayload: { ...resolvedEvent, idempotencyKey: fallbackKey } });
      deliveryId = created.id;
    } else {
      deliveryId = existing.id;
    }
  }

  // Claim lease
  let claimed: { id: string; token: string } | null = null;
  if (input.deliveryId) {
    claimed = await claimWarRoomDeliveryById(deliveryId!);
  } else {
    claimed = await claimWarRoomDelivery({ provider: resolvedProvider!, idempotencyKey: resolvedIdempotencyKey! });
  }
  if (!claimed) return;
  deliveryId = claimed.id;
  leaseToken = claimed.token;

  // Ensure we have event for adapter
  if (!resolvedEvent || !resolvedProvider || !resolvedIdempotencyKey) {
    const row = await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: deliveryId }, select: { provider: true, idempotencyKey: true, eventPayload: true } });
    if (!row) throw new Error('Delivery disappeared after claim');
    resolvedProvider = row.provider as WarRoomProviderName;
    resolvedIdempotencyKey = row.idempotencyKey;
    resolvedEvent = row.eventPayload as unknown as WarRoomIncidentEvent;
  }

  try {
    const adapter = getWarRoomProvider(resolvedProvider);
    const event = resolvedIdempotencyKey ? ({ ...resolvedEvent, idempotencyKey: resolvedIdempotencyKey } as WarRoomIncidentEvent) : resolvedEvent;
    const result = await adapter.handleIncidentEvent(event, { deliveryId, deliveryLeaseToken: leaseToken, idempotencyKey: resolvedIdempotencyKey });
    if (!result.ok) {
      if (result.code === 'AMBIGUOUS_SIDE_EFFECT') {
        const valid = await validateDeliveryLease(deliveryId, leaseToken);
        if (!valid) return;
        await prisma.warRoomProviderEventDelivery.updateMany({
          where: { id: deliveryId, leaseToken },
          data: { status: 'COMPLETED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
        });
        try {
          const { ensureWarRoomStage, markStageAmbiguous } = await import('./delivery');
          await ensureWarRoomStage(deliveryId, 'provider:ambiguous');
          await markStageAmbiguous(deliveryId, 'provider:ambiguous', result.message);
        } catch {}
        return;
      }
      throw new Error(`${adapter.provider}: ${result.message}`);
    }
    await completeWarRoomDelivery(deliveryId, leaseToken);
  } catch (error) {
    if (deliveryId && leaseToken) {
      await releaseWarRoomDeliveryForRetry(deliveryId, leaseToken);
    }
    throw error;
  }
}
