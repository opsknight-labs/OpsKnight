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
