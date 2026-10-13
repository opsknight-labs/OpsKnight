import type { AuditEntityType, Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';

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
}
