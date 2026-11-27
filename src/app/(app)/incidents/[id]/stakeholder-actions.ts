'use server';

import { z } from 'zod/v3';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import {
  notifyIncidentStakeholders,
  stakeholderRecipients,
} from '@/lib/business-services/stakeholder-comms';
import { impactedBusinessServicesForIncident } from '@/lib/business-services/commands';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import { AUTHORIZATION_ACTIONS, authorize } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export type NotifyStakeholdersResult =
  { ok: true; recipientCount: number } | { ok: false; error: string };

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

const PreviewSchema = z.object({
  incidentId: z.string().trim().min(1).max(100),
  businessServiceIds: z.array(z.string().trim().min(1).max(100)).max(100),
});

/**
 * Read-only: how many people would get the update, before sending. The same access rule as
 * sending (incident note permission) and only business services this incident impacts and the
 * viewer can see; the count is before per-person cadence, so it is an upper bound.
 */
export async function previewStakeholderRecipientsAction(
  incidentId: string,
  businessServiceIds: string[]
): Promise<{ ok: true; recipientCount: number } | { ok: false; error: string }> {
  try {
    const input = PreviewSchema.parse({ incidentId, businessServiceIds });
    const actor = await getCurrentAuthorizationActor();
    const resource = await resolveIncidentResourceForActor(actor, input.incidentId);
    if (
      !resource ||
      !authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_NOTE, resource }).allowed
    )
      return { ok: false, error: 'You cannot notify stakeholders of this incident.' };
    const impacted = new Set(
      (await impactedBusinessServicesForIncident(actor, input.incidentId))
        .filter(impact => !impact.excluded)
        .map(impact => impact.id)
    );
    const ids = input.businessServiceIds.filter(id => impacted.has(id));
    return { ok: true, recipientCount: (await stakeholderRecipients(ids)).length };
  } catch {
    return { ok: false, error: 'Could not count the recipients.' };
  }
}
