import type { AuditEntityType, Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import { logger } from '@/lib/logger';

export async function logV2Audit(params: {
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  actorId: string;
  apiKeyId?: string | null;
  details?: Record<string, unknown>;
  requestId?: string;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const auditDetails: Record<string, unknown> = {
    ...(params.details ?? {}),
    apiGateway: 'api_v2',
    apiKeyId: params.apiKeyId ?? null,
  };

  try {
    await logAudit(
      {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        actorId: params.actorId,
        source: 'API',
        requestId: params.requestId,
        details: auditDetails as Prisma.InputJsonValue,
      },
      params.tx
    );
  } catch (error) {
    if (params.tx) {
      // If part of an atomic transaction, preserve transaction rollback integrity
      throw error;
    }
    // Prevent post-commit audit logging failures from surfacing as false mutation errors to client
    logger.error('api_v2.audit_log_failed', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error,
    });
  }
}

export type V2AuditParams = Omit<Parameters<typeof logV2Audit>[0], 'tx'>;

/**
 * Run a business mutation and its mandatory audit record in one transaction.
 * If the audit insert fails the mutation rolls back, so a successful response
 * can never exist without its audit record. Pass an existing transaction (for
 * example the idempotency transaction) to join it instead of opening a new one.
 */
export async function runV2AuditedMutation<T>(
  mutate: (tx: Prisma.TransactionClient) => Promise<T>,
  audit: (result: T) => V2AuditParams,
  existingTx?: Prisma.TransactionClient
): Promise<T> {
  const run = async (tx: Prisma.TransactionClient) => {
    const result = await mutate(tx);
    await logV2Audit({ ...audit(result), tx });
    return result;
  };
  if (existingTx) return run(existingTx);
  const { default: prisma } = await import('@/lib/prisma');
  return prisma.$transaction(run);
}
