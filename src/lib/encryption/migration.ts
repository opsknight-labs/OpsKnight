/**
 * Encryption migration engine.
 * Executes Preview, CAS Migrate, and Verify flows with checkpointing and race protection.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../logger';
import { decryptWithKey, encryptWithKey, getMigrationKeyring } from '../encryption';
import { ENCRYPTION_TARGETS, computeRegistryFingerprint } from './registry';
import { EncryptionTargetDefinition, MigrationMode } from './types';
import { getModelDelegate, scanTargetBatch, countTargetTotal } from './inventory';
import { inspectValue } from './inspect';
import { emitAuditEvent } from '../audit';

export interface ExecuteRunOptions {
  runId: string;
  prisma: PrismaClient;
  onProgress?: (summary: { processed: number; total: number }) => Promise<void>;
  _beforeCasUpdate?: (targetId: string, recordId: string) => Promise<void>;
}

export async function executeMigrationRun(options: ExecuteRunOptions): Promise<void> {
  const { runId, prisma, _beforeCasUpdate } = options;

  const run = await prisma.encryptionMigrationRun.findUnique({
    where: { id: runId },
    include: { targetStates: true },
  });

  if (!run) {
    throw new Error(`Encryption migration run not found: ${runId}`);
  }

  if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
    return;
  }

  const keyring = await getMigrationKeyring(prisma);
  const activeKey = keyring.find(k => k.source === 'env') ?? keyring[0];

  if (run.mode === 'MIGRATE' && (!activeKey || activeKey.source !== 'env')) {
    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage: 'Cannot migrate: no active encryption key configured in keyring',
        completedAt: new Date(),
      },
    });
    return;
  }

  const currentFingerprint = computeRegistryFingerprint(ENCRYPTION_TARGETS);

  // Mark run as RUNNING
  await prisma.encryptionMigrationRun.update({
    where: { id: runId },
    data: {
      status: 'RUNNING',
      startedAt: run.startedAt ?? new Date(),
      activeKeyId: activeKey?.id ?? null,
      registryFingerprint: currentFingerprint,
    },
  });

  try {
    // Ensure all target states exist
    for (const target of ENCRYPTION_TARGETS) {
      let state = run.targetStates.find(s => s.targetId === target.id);
      if (!state) {
        const total = await countTargetTotal(prisma, target);
        state = await prisma.encryptionMigrationTargetState.create({
          data: {
            runId,
            targetId: target.id,
            status: 'PENDING',
            totalCount: total,
          },
        });
      }
    }

    // Refresh run with target states
    const updatedRun = await prisma.encryptionMigrationRun.findUniqueOrThrow({
      where: { id: runId },
      include: { targetStates: true },
    });

    // Process targets sequentially
    for (const target of ENCRYPTION_TARGETS) {
      // Check for cancellation before starting each target
      const currentRunCheck = await prisma.encryptionMigrationRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (currentRunCheck?.status === 'CANCELLED') {
        logger.info(`[Encryption Migration] Run ${runId} was cancelled.`);
        return;
      }

      const targetState = updatedRun.targetStates.find(s => s.targetId === target.id);
      if (targetState?.status === 'COMPLETED') {
        continue;
      }

      await executeTargetLifecycle({
        prisma,
        runId,
        mode: run.mode,
        target,
        targetState: targetState!,
        keyring,
        activeKey: activeKey ?? null,
        _beforeCasUpdate,
      });
    }

    // Aggregate overall totals
    const finalStates = await prisma.encryptionMigrationTargetState.findMany({
      where: { runId },
    });

    const totalRecords = finalStates.reduce((acc, s) => acc + s.totalCount, 0);
    const processedRecords = finalStates.reduce((acc, s) => acc + s.processedCount, 0);
    const migratedRecords = finalStates.reduce((acc, s) => acc + s.migratedCount, 0);
    const errorRecords = finalStates.reduce((acc, s) => acc + s.errorCount, 0);
    const conflictRecords = finalStates.reduce((acc, s) => acc + s.conflictCount, 0);
    const skippedRecords = processedRecords - migratedRecords - errorRecords - conflictRecords;

    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        totalRecords,
        processedRecords,
        migratedRecords,
        errorRecords,
        conflictRecords,
        skippedRecords: Math.max(0, skippedRecords),
        completedAt: new Date(),
      },
    });

    await emitAuditEvent({
      action:
        run.mode === 'VERIFY'
          ? 'ENCRYPTION_VERIFICATION_COMPLETED'
          : 'ENCRYPTION_MIGRATION_COMPLETED',
      source: 'BACKGROUND',
      target: { type: 'ENCRYPTION_MIGRATION', id: runId },
      metadata: {
        mode: run.mode,
        totalRecords,
        processedRecords,
        migratedRecords,
        errorRecords,
        conflictRecords,
      },
    });

    logger.info(`[Encryption Migration] Run ${runId} (${run.mode}) completed successfully.`, {
      totalRecords,
      migratedRecords,
      errorRecords,
      conflictRecords,
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown migration error';
    logger.error(`[Encryption Migration] Run ${runId} failed`, { error });
    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage: errorMsg,
        completedAt: new Date(),
      },
    });
    await emitAuditEvent({
      action: 'ENCRYPTION_MIGRATION_FAILED',
      source: 'BACKGROUND',
      target: { type: 'ENCRYPTION_MIGRATION', id: runId },
      metadata: {
        mode: run.mode,
        error: errorMsg,
      },
    });
    throw error;
  }
}

interface TargetLifecycleContext {
  prisma: PrismaClient;
  runId: string;
  mode: MigrationMode;
  target: EncryptionTargetDefinition;
  targetState: {
    id: string;
    cursor: string | null;
    processedCount: number;
    migratedCount: number;
    errorCount: number;
    conflictCount: number;
    keysDetected: unknown;
    inspectionStats?: unknown;
  };
  keyring: Array<{ id: string; key: string }>;
  activeKey: { id: string; key: string } | null;
  _beforeCasUpdate?: (targetId: string, recordId: string) => Promise<void>;
}

async function executeTargetLifecycle(ctx: TargetLifecycleContext): Promise<void> {
  const { prisma, runId, mode, target, keyring, activeKey } = ctx;
  const batchSize = 100;
  let cursor = ctx.targetState.cursor;
  let processedCount = ctx.targetState.processedCount;
  let migratedCount = ctx.targetState.migratedCount;
  let errorCount = ctx.targetState.errorCount;
  let conflictCount = ctx.targetState.conflictCount;
  const keysDetectedMap = new Map<string, number>();

  if (typeof ctx.targetState.keysDetected === 'object' && ctx.targetState.keysDetected !== null) {
    for (const [k, v] of Object.entries(ctx.targetState.keysDetected as Record<string, number>)) {
      keysDetectedMap.set(k, Number(v) || 0);
    }
  }

  const inspectionStats = {
    currentV3: 0,
    oldKeyV3: 0,
    legacyV2: 0,
    legacyV1: 0,
    plaintext: 0,
    unavailableKey: 0,
    ambiguous: 0,
    unreadable: 0,
    empty: 0,
  };

  if (
    typeof ctx.targetState.inspectionStats === 'object' &&
    ctx.targetState.inspectionStats !== null
  ) {
    const prev = ctx.targetState.inspectionStats as Record<string, number>;
    inspectionStats.currentV3 = Number(prev.currentV3) || 0;
    inspectionStats.oldKeyV3 = Number(prev.oldKeyV3) || 0;
    inspectionStats.legacyV2 = Number(prev.legacyV2) || 0;
    inspectionStats.legacyV1 = Number(prev.legacyV1) || 0;
    inspectionStats.plaintext = Number(prev.plaintext) || 0;
    inspectionStats.unavailableKey = Number(prev.unavailableKey) || 0;
    inspectionStats.ambiguous = Number(prev.ambiguous) || 0;
    inspectionStats.unreadable = Number(prev.unreadable) || 0;
    inspectionStats.empty = Number(prev.empty) || 0;
  }

  await prisma.encryptionMigrationTargetState.update({
    where: { id: ctx.targetState.id },
    data: { status: 'RUNNING' },
  });

  let hasMore = true;

  while (hasMore) {
    // Check if run cancelled
    const checkRun = await prisma.encryptionMigrationRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (checkRun?.status === 'CANCELLED') {
      return;
    }

    const batch = await scanTargetBatch(
      prisma,
      target,
      cursor,
      batchSize,
      keyring,
      activeKey?.id ?? null
    );

    // Merge detected keys
    for (const [k, count] of Object.entries(batch.stats.keysDetected)) {
      const current = keysDetectedMap.get(k) || 0;
      keysDetectedMap.set(k, current + count);
    }

    // Merge inspection statistics
    inspectionStats.currentV3 += batch.stats.currentV3;
    inspectionStats.oldKeyV3 += batch.stats.oldKeyV3;
    inspectionStats.legacyV2 += batch.stats.legacyV2;
    inspectionStats.legacyV1 += batch.stats.legacyV1;
    inspectionStats.plaintext += batch.stats.plaintext;
    inspectionStats.unavailableKey += batch.stats.unavailableKey;
    inspectionStats.ambiguous += batch.stats.ambiguous;
    inspectionStats.unreadable += batch.stats.unreadable;
    inspectionStats.empty += batch.stats.empty;

    if (mode === 'PREVIEW' || mode === 'VERIFY') {
      // Non-destructive read-only classification
      processedCount += batch.recordsScanned;
      // In PREVIEW and VERIFY, migratedCount remains 0 because nothing is modified
      errorCount += batch.stats.unavailableKey + batch.stats.ambiguous + batch.stats.unreadable;

      // Log issues for unreadable / unavailable keys during verify or preview
      for (const rec of batch.records) {
        if (target.storageType === 'SCALAR' || target.storageType === 'USER_DEVICE_TOKEN') {
          const val =
            typeof rec.rawRecord[target.field] === 'string'
              ? (rec.rawRecord[target.field] as string)
              : null;
          const insp = await inspectValue(
            val,
            target.plaintextLegacyAllowed,
            keyring,
            activeKey?.id ?? null
          );
          if (
            insp.classification === 'UNAVAILABLE_KEY' ||
            insp.classification === 'AMBIGUOUS' ||
            insp.classification === 'UNREADABLE'
          ) {
            await recordIssue(
              prisma,
              runId,
              target.id,
              rec.id,
              target.field,
              insp.classification,
              insp.details
            );
          }
        }
      }
    } else if (mode === 'MIGRATE') {
      // Execute Compare-And-Swap mutations
      for (const rec of batch.records) {
        processedCount++;
        const recordId = rec.id;

        if (target.storageType === 'SCALAR' || target.storageType === 'USER_DEVICE_TOKEN') {
          const originalVal =
            typeof rec.rawRecord[target.field] === 'string'
              ? (rec.rawRecord[target.field] as string)
              : null;
          const insp = await inspectValue(
            originalVal,
            target.plaintextLegacyAllowed,
            keyring,
            activeKey?.id ?? null
          );

          if (insp.classification === 'CURRENT_V3' || insp.classification === 'EMPTY') {
            continue;
          }

          if (
            insp.classification === 'UNAVAILABLE_KEY' ||
            insp.classification === 'AMBIGUOUS' ||
            insp.classification === 'UNREADABLE'
          ) {
            errorCount++;
            await recordIssue(
              prisma,
              runId,
              target.id,
              recordId,
              target.field,
              insp.classification,
              insp.details
            );
            continue;
          }

          if (!originalVal) {
            continue;
          }

          // Plaintext or legacy/old-key ciphertext to migrate:
          try {
            let plaintext: string;
            if (insp.classification === 'PLAINTEXT') {
              plaintext = originalVal;
            } else {
              // Decrypt with recognized key
              const keyEntry = keyring.find(k => k.id === insp.detectedKeyId);
              if (!keyEntry) {
                throw new Error(`Detected key ${insp.detectedKeyId} not found in keyring`);
              }
              plaintext = await decryptWithKey(originalVal, keyEntry.key);
            }

            // Encrypt with active key
            const newCiphertext = await encryptWithKey(plaintext, activeKey!.key, activeKey!.id);

            // Optional test hook for concurrent race testing
            if (ctx._beforeCasUpdate) {
              await ctx._beforeCasUpdate(target.id, recordId);
            }

            // CAS update
            const delegate = getModelDelegate(prisma, target.model);
            const whereClause: Record<string, unknown> = {
              id: recordId,
            };
            whereClause[target.field] = originalVal;

            const updateData: Record<string, unknown> = {};
            updateData[target.field] = newCiphertext;

            const updateResult = await delegate.updateMany({
              where: whereClause,
              data: updateData,
            });

            if (updateResult.count === 0) {
              // Record was updated concurrently by another transaction or user
              conflictCount++;
              logger.warn(
                `[Encryption Migration] CAS conflict on ${target.model}.${target.field} (ID: ${recordId}). Record was modified concurrently.`
              );
            } else {
              migratedCount++;
            }
          } catch (err: unknown) {
            errorCount++;
            const msg = err instanceof Error ? err.message : 'Decryption/encryption failed';
            await recordIssue(
              prisma,
              runId,
              target.id,
              recordId,
              target.field,
              'MIGRATION_ERROR',
              msg
            );
          }
        } else if (target.storageType === 'JSON_FIELD') {
          // NotificationProvider.config
          const configObj = rec.rawRecord[target.field];
          if (!configObj || typeof configObj !== 'object') {
            continue;
          }

          const rawConfig = configObj as Record<string, unknown>;
          const jsonKeys = target.jsonKeys || [];
          let needsUpdate = false;
          const slotsToMigrate: Array<{ key: string; originalVal: string; plaintext: string }> = [];
          const nestedSlotsToMigrate: Array<{
            arrayField: string;
            index: number;
            itemField: string;
            originalVal: string;
            plaintext: string;
          }> = [];

          for (const key of jsonKeys) {
            if (Object.prototype.hasOwnProperty.call(rawConfig, key)) {
              const rawVal = Reflect.get(rawConfig, key);
              if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
                const strVal = String(rawVal);
                const isEncPrefixed = strVal.startsWith('enc:');
                const toInspect = isEncPrefixed ? strVal.slice(4) : strVal;

                const insp = await inspectValue(
                  toInspect,
                  target.plaintextLegacyAllowed,
                  keyring,
                  activeKey?.id ?? null
                );
                if (insp.classification === 'CURRENT_V3' || insp.classification === 'EMPTY') {
                  continue;
                }
                if (
                  insp.classification === 'UNAVAILABLE_KEY' ||
                  insp.classification === 'AMBIGUOUS' ||
                  insp.classification === 'UNREADABLE'
                ) {
                  errorCount++;
                  await recordIssue(
                    prisma,
                    runId,
                    target.id,
                    recordId,
                    `${target.field}.${key}`,
                    insp.classification,
                    insp.details
                  );
                  continue;
                }

                try {
                  let plaintext: string;
                  if (insp.classification === 'PLAINTEXT') {
                    plaintext = toInspect;
                  } else {
                    const keyEntry = keyring.find(k => k.id === insp.detectedKeyId);
                    if (!keyEntry) throw new Error(`Key ${insp.detectedKeyId} not found`);
                    plaintext = await decryptWithKey(toInspect, keyEntry.key);
                  }
                  slotsToMigrate.push({ key, originalVal: strVal, plaintext });
                  needsUpdate = true;
                } catch (err: unknown) {
                  errorCount++;
                  const msg = err instanceof Error ? err.message : 'JSON slot migration failed';
                  await recordIssue(
                    prisma,
                    runId,
                    target.id,
                    recordId,
                    `${target.field}.${key}`,
                    'MIGRATION_ERROR',
                    msg
                  );
                }
              }
            }
          }

          // Check nested array paths like vapidKeyHistory[].privateKey
          if (target.nestedArrayPaths) {
            for (const nested of target.nestedArrayPaths) {
              if (Object.prototype.hasOwnProperty.call(rawConfig, nested.arrayField)) {
                const arr = Reflect.get(rawConfig, nested.arrayField);
                if (Array.isArray(arr)) {
                  for (const [i, item] of (arr as unknown[]).entries()) {
                    if (
                      item &&
                      typeof item === 'object' &&
                      Object.prototype.hasOwnProperty.call(item, nested.itemField)
                    ) {
                      const itemVal = Reflect.get(
                        item as Record<string, unknown>,
                        nested.itemField
                      );
                      if (itemVal !== undefined && itemVal !== null && itemVal !== '') {
                        const strVal = String(itemVal);
                        const isEncPrefixed = strVal.startsWith('enc:');
                        const toInspect = isEncPrefixed ? strVal.slice(4) : strVal;

                        const insp = await inspectValue(
                          toInspect,
                          target.plaintextLegacyAllowed,
                          keyring,
                          activeKey?.id ?? null
                        );
                        if (
                          insp.classification === 'CURRENT_V3' ||
                          insp.classification === 'EMPTY'
                        ) {
                          continue;
                        }
                        if (
                          insp.classification === 'UNAVAILABLE_KEY' ||
                          insp.classification === 'AMBIGUOUS' ||
                          insp.classification === 'UNREADABLE'
                        ) {
                          errorCount++;
                          await recordIssue(
                            prisma,
                            runId,
                            target.id,
                            recordId,
                            `${target.field}.${nested.arrayField}[${i}].${nested.itemField}`,
                            insp.classification,
                            insp.details
                          );
                          continue;
                        }

                        try {
                          let plaintext: string;
                          if (insp.classification === 'PLAINTEXT') {
                            plaintext = toInspect;
                          } else {
                            const keyEntry = keyring.find(k => k.id === insp.detectedKeyId);
                            if (!keyEntry) throw new Error(`Key ${insp.detectedKeyId} not found`);
                            plaintext = await decryptWithKey(toInspect, keyEntry.key);
                          }
                          nestedSlotsToMigrate.push({
                            arrayField: nested.arrayField,
                            index: i,
                            itemField: nested.itemField,
                            originalVal: strVal,
                            plaintext,
                          });
                          needsUpdate = true;
                        } catch (err: unknown) {
                          errorCount++;
                          const msg =
                            err instanceof Error
                              ? err.message
                              : 'Nested JSON slot migration failed';
                          await recordIssue(
                            prisma,
                            runId,
                            target.id,
                            recordId,
                            `${target.field}.${nested.arrayField}[${i}].${nested.itemField}`,
                            'MIGRATION_ERROR',
                            msg
                          );
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          if (needsUpdate && (slotsToMigrate.length > 0 || nestedSlotsToMigrate.length > 0)) {
            try {
              if (ctx._beforeCasUpdate) {
                await ctx._beforeCasUpdate(target.id, recordId);
              }

              // Optimistic CAS inside a transaction using updatedAt versioning
              const outcome = await prisma.$transaction(async tx => {
                const current = await tx.notificationProvider.findUnique({
                  where: { id: recordId },
                  select: { id: true, config: true, updatedAt: true },
                });
                if (!current || !current.config || typeof current.config !== 'object') {
                  return 'CONFLICT';
                }
                const versionRead = current.updatedAt;
                const currentCfg = JSON.parse(JSON.stringify(current.config)) as Record<
                  string,
                  unknown
                >;

                // Validate root slots
                for (const slot of slotsToMigrate) {
                  if (String(currentCfg[slot.key]) !== slot.originalVal) {
                    return 'CONFLICT';
                  }
                }

                // Validate nested slots
                for (const nSlot of nestedSlotsToMigrate) {
                  const arr = currentCfg[nSlot.arrayField];
                  if (!Array.isArray(arr) || !arr[nSlot.index]) {
                    return 'CONFLICT';
                  }
                  const item = arr[nSlot.index] as Record<string, unknown>;
                  if (String(item[nSlot.itemField]) !== nSlot.originalVal) {
                    return 'CONFLICT';
                  }
                }

                // Re-encrypt root slots
                for (const slot of slotsToMigrate) {
                  const newCipher = await encryptWithKey(
                    slot.plaintext,
                    activeKey!.key,
                    activeKey!.id
                  );
                  currentCfg[slot.key] = 'enc:' + newCipher;
                }

                // Re-encrypt nested slots
                for (const nSlot of nestedSlotsToMigrate) {
                  const arr = currentCfg[nSlot.arrayField] as Array<Record<string, unknown>>;
                  const newCipher = await encryptWithKey(
                    nSlot.plaintext,
                    activeKey!.key,
                    activeKey!.id
                  );
                  arr[nSlot.index][nSlot.itemField] = 'enc:' + newCipher;
                }

                const updateRes = await tx.notificationProvider.updateMany({
                  where: {
                    id: recordId,
                    updatedAt: versionRead,
                  },
                  data: { config: currentCfg as Prisma.InputJsonObject },
                });

                if (updateRes.count === 0) {
                  return 'CONFLICT';
                }
                return 'SUCCESS';
              });

              if (outcome === 'CONFLICT') {
                conflictCount++;
              } else {
                migratedCount += slotsToMigrate.length + nestedSlotsToMigrate.length;
              }
            } catch (err: unknown) {
              errorCount++;
              const msg = err instanceof Error ? err.message : 'JSON provider update failed';
              await recordIssue(
                prisma,
                runId,
                target.id,
                recordId,
                target.field,
                'MIGRATION_ERROR',
                msg
              );
            }
          }
        }
      }
    }

    cursor = batch.nextCursor;
    hasMore = batch.hasMore && cursor !== null;

    const keysDetectedObj = Object.fromEntries(keysDetectedMap.entries());

    // Save checkpoint for this target
    await prisma.encryptionMigrationTargetState.update({
      where: { id: ctx.targetState.id },
      data: {
        cursor,
        processedCount,
        migratedCount,
        errorCount,
        conflictCount,
        keysDetected: keysDetectedObj,
        inspectionStats,
      },
    });

    // Update parent run progress by aggregating across ALL target states
    const allStates = await prisma.encryptionMigrationTargetState.findMany({
      where: { runId },
      select: {
        processedCount: true,
        migratedCount: true,
        errorCount: true,
        conflictCount: true,
      },
    });
    const totalProcessed = allStates.reduce((acc, s) => acc + s.processedCount, 0);
    const totalMigrated = allStates.reduce((acc, s) => acc + s.migratedCount, 0);
    const totalErrors = allStates.reduce((acc, s) => acc + s.errorCount, 0);
    const totalConflicts = allStates.reduce((acc, s) => acc + s.conflictCount, 0);

    await prisma.encryptionMigrationRun.update({
      where: { id: runId },
      data: {
        processedRecords: totalProcessed,
        migratedRecords: totalMigrated,
        errorRecords: totalErrors,
        conflictRecords: totalConflicts,
      },
    });
  }

  // Mark target state completed
  await prisma.encryptionMigrationTargetState.update({
    where: { id: ctx.targetState.id },
    data: { status: 'COMPLETED' },
  });
}

async function recordIssue(
  prisma: PrismaClient,
  runId: string,
  targetId: string,
  recordId: string,
  fieldPath: string,
  classification: string,
  errorMessage?: string
): Promise<void> {
  try {
    await prisma.encryptionMigrationIssue.create({
      data: {
        runId,
        targetId,
        recordId,
        fieldPath,
        classification,
        errorMessage: errorMessage?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    logger.error('[Encryption Migration] Failed to record issue', { err });
  }
}
