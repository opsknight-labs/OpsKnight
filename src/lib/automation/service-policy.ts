import 'server-only';
import { assertPolicyActive } from '@/lib/escalation/policy-lifecycle';
import type { Prisma } from '@prisma/client';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  assertResponderPolicySnapshotSafe,
  lockResponderPolicy,
} from '@/lib/escalation/automation-snapshot';
import { lockAutomationService } from './locking';
import { AppError } from '@/lib/errors';

/**
 * Rules for pointing a service at an escalation policy, shared by the UI and the API:
 * the policy must be active, and a LIVE-automation service needs a snapshot-safe one.
 * Pass serviceId null for a service that does not exist yet.
 */
export async function assertServicePolicyAssignable(
  tx: Prisma.TransactionClient,
  serviceId: string | null,
  policyId: string | null | undefined
) {
  if (serviceId) await lockAutomationService(tx, serviceId);
  const config = serviceId
    ? await tx.serviceAutomationConfig.findUnique({ where: { serviceId }, select: { mode: true } })
    : null;
  if (policyId) await assertPolicyActive(tx, policyId);
  if (config?.mode === 'LIVE' && policyId) {
    await lockResponderPolicy(tx, policyId);
    await assertResponderPolicySnapshotSafe(tx, policyId);
  }
}

/** API variant: a rule violation becomes a 409 problem instead of a 500. */
export async function assertServicePolicyAssignableForApi(
  tx: Prisma.TransactionClient,
  serviceId: string | null,
  policyId: string | null | undefined
) {
  try {
    await assertServicePolicyAssignable(tx, serviceId, policyId);
  } catch (error) {
    // The rule checks throw plain Errors; anything else (DB, AppError) propagates unchanged.
    if (error instanceof Error && error.constructor === Error) {
      throw new AppError({ code: 'RESOURCE_CONFLICT', userMessage: error.message });
    }
    throw error;
  }
}

export async function updateServiceWithAutomationPolicyGuard(
  serviceId: string,
  data: Prisma.ServiceUncheckedUpdateInput & { escalationPolicyId: string | null }
) {
  return runSerializableTransaction(async tx => {
    await assertServicePolicyAssignable(tx, serviceId, data.escalationPolicyId);
    return tx.service.update({ where: { id: serviceId }, data });
  });
}
