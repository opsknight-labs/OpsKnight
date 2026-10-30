import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { RUNBOOK_STEP_TYPES } from '@/lib/runbooks/types';
import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';

export const FleetAgentParams = z.object({ id: z.string().cuid() }).strict();
export const EnrollmentBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    hostname: z.string().trim().min(1).max(255).optional(),
  })
  .strict();
export const FLEET_SELECT = {
  id: true,
  name: true,
  hostname: true,
  status: true,
  version: true,
  platform: true,
  capabilities: true,
  policyHash: true,
  lastHeartbeatAt: true,
  spoolDepth: true,
  deadLetterDepth: true,
  activeAttemptCount: true,
  lastError: true,
  enrollmentExpiresAt: true,
  enrolledAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RunbookAgentSelect;
type FleetRow = Prisma.RunbookAgentGetPayload<{ select: typeof FLEET_SELECT }>;
const capabilityNames = new Set([
  ...RUNBOOK_STEP_TYPES.flatMap(type => [type, `RUNBOOK_${type}`]),
  'RUNBOOK_PODMAN',
  'RUNBOOK_DOCKER_RUNTIME',
]);
/** Intentionally excludes signing keys, enrollment hashes and unstructured diagnostic reports. */
export function projectFleetAgent(row: FleetRow) {
  return {
    id: row.id,
    name: redactRunbookDisplayName(row.name),
    hostname: row.hostname,
    status: row.status,
    version: row.version,
    platform: row.platform,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter(
          (item): item is string => typeof item === 'string' && capabilityNames.has(item)
        )
      : [],
    policyHash: row.policyHash && /^[a-f0-9]{64}$/.test(row.policyHash) ? row.policyHash : null,
    lastHeartbeatAt: row.lastHeartbeatAt,
    spoolDepth: row.spoolDepth,
    deadLetterDepth: row.deadLetterDepth,
    activeAttemptCount: row.activeAttemptCount,
    hasDiagnosticError: Boolean(row.lastError),
    enrolledAt: row.enrolledAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
export async function requireFleetAgent(
  tx: Pick<Prisma.TransactionClient, 'runbookAgent'>,
  id: string
) {
  const row = await tx.runbookAgent.findUnique({ where: { id }, select: FLEET_SELECT });
  if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent not found.' });
  return row;
}
