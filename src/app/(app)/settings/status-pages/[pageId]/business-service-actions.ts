'use server';

import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { setStatusPageBusinessServiceOverride } from '@/lib/status-pages/business-service-overrides';
import { AppError } from '@/lib/errors';

/** Pins or clears a business service's public status on a page. Returns an error message or null. */
export async function setBusinessServiceOverrideAction(
  pageId: string,
  businessServiceId: string,
  next: { status: string | null; until: string | null }
): Promise<string | null> {
  try {
    await setStatusPageBusinessServiceOverride(pageId, businessServiceId, next, {
      actor: await getCurrentAuthorizationActor(),
    });
    return null;
  } catch (error) {
    return error instanceof AppError && error.userMessage
      ? error.userMessage
      : 'Could not apply the override.';
  }
}
