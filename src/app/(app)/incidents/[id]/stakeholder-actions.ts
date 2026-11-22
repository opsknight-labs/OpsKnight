'use server';

import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { notifyIncidentStakeholders } from '@/lib/business-services/stakeholder-comms';
import { AppError } from '@/lib/errors';

export type NotifyStakeholdersResult =
  | { ok: true; recipientCount: number }
  | { ok: false; error: string };

/** "Notify stakeholders" on the incident page: templated email + in-app, never a page. */
export async function notifyStakeholdersAction(
  incidentId: string,
  input: { phase: string; message: string; businessServiceIds?: string[] }
): Promise<NotifyStakeholdersResult> {
  try {
    const result = await notifyIncidentStakeholders(incidentId, input, {
      actor: await getCurrentAuthorizationActor(),
    });
    return { ok: true, recipientCount: result.recipientCount };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AppError && error.userMessage
          ? error.userMessage
          : 'Could not notify stakeholders.',
    };
  }
}
