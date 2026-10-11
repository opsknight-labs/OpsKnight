import 'server-only';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  assertResponderPolicySnapshotSafe,
  lockResponderPolicy,
} from '@/lib/escalation/automation-snapshot';
import { lockAutomationService } from './locking';

export async function updateServiceWithAutomationPolicyGuard(
  serviceId: string,
  data: Prisma.ServiceUncheckedUpdateInput & { escalationPolicyId: string | null }
) {
  return runSerializableTransaction(async tx => {
    await lockAutomationService(tx, serviceId);
    const config = await tx.serviceAutomationConfig.findUnique({
      where: { serviceId },
      select: { mode: true },
    });
    if (config?.mode === 'LIVE' && data.escalationPolicyId) {
      await lockResponderPolicy(tx, data.escalationPolicyId);
      await assertResponderPolicySnapshotSafe(tx, data.escalationPolicyId);
    }
    return tx.service.update({ where: { id: serviceId }, data });
  });
}
