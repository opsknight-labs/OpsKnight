'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';
import { assertAdmin } from '@/lib/rbac';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { runSerializableTransaction } from '@/lib/db-utils';
import type { SloAlertPolicyView } from '@/lib/slo/burn-alerts/contract';
import {
  getSloAlertPolicy,
  listSloAlertConnections,
  saveSloAlertPolicy,
  sloAlertEligibility,
  testSloAlertQueries,
} from '@/lib/slo/burn-alerts/service';

const lineage = z.string().regex(/^[a-z0-9_-]{1,64}$/i);

export type SloAlertingData =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      policy: SloAlertPolicyView | null;
      connections: Array<{ id: string; name: string }>;
    };

export type SloAlertActionState = {
  ok: boolean;
  message: string;
  /** Set by "Test queries": what the queries measure over the last hour. */
  test?: { sli: number | null; burn1h: number | null; good: number; total: number; steps: number };
};

function failure(error: unknown): SloAlertActionState {
  if (error instanceof AppError) {
    const detail = error.fields?.[0];
    return { ok: false, message: detail ? detail.message : error.userMessage };
  }
  logger.error('[SLO] Alert policy action failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return { ok: false, message: 'Unable to save. Refresh and try again.' };
}

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};
const policyInput = (form: FormData) => ({
  connectionId: text(form, 'connectionId'),
  goodQuery: text(form, 'goodQuery'),
  totalQuery: text(form, 'totalQuery'),
  enabled: form.get('enabled') === 'on',
  ticketsEnabled: form.get('ticketsEnabled') === 'on',
});

/** What the Alerting step needs for one objective; administrators only. */
export async function loadSloAlerting(objectiveId: string): Promise<SloAlertingData> {
  await assertAdmin();
  const id = lineage.parse(objectiveId);
  const reason = await sloAlertEligibility(id);
  if (reason) return { eligible: false, reason };
  const [policy, connections] = await Promise.all([
    getSloAlertPolicy(id),
    listSloAlertConnections(id),
  ]);
  return { eligible: true, policy, connections };
}

export async function saveSloAlertPolicyAction(
  _state: SloAlertActionState,
  form: FormData
): Promise<SloAlertActionState> {
  try {
    const actor = await assertAdmin();
    const id = lineage.parse(form.get('objectiveId'));
    const saved = await runSerializableTransaction(tx =>
      saveSloAlertPolicy(tx, id, policyInput(form), { id: actor.id, source: 'UI' })
    );
    revalidatePath('/settings/service-objectives');
    return {
      ok: true,
      message: saved.enabled
        ? 'Alerting saved. The policy is evaluated every 5 minutes.'
        : 'Alerting saved. It stays off until you enable it.',
    };
  } catch (error) {
    return failure(error);
  }
}

/** Runs both queries over the last hour without saving; reports the SLI and burn they imply. */
export async function testSloAlertQueriesAction(
  _state: SloAlertActionState,
  form: FormData
): Promise<SloAlertActionState> {
  try {
    await assertAdmin();
    const id = lineage.parse(form.get('objectiveId'));
    const result = await testSloAlertQueries(id, policyInput(form));
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      message:
        result.total > 0
          ? 'Both queries answered.'
          : 'The queries answered but counted no events in the last hour.',
      test: {
        sli: result.sli,
        burn1h: result.burn1h,
        good: result.good,
        total: result.total,
        steps: result.steps,
      },
    };
  } catch (error) {
    return failure(error);
  }
}
