/**
 * @deprecated Prefer `toUserFacingError()` / `getUserFacingErrorMessage()` from
 * `@/lib/user-facing-error`. This module is a compatibility shim only and must
 * not infer error semantics from English message text.
 */
import { isAppError } from './errors';
import { getUserFacingErrorMessage } from './user-facing-error';

export function getUserFriendlyError(error: unknown): string {
  // Typed application errors already carry explicitly trusted public copy.
  // Preserve contextual messages without reclassifying them from English text.
  if (isAppError(error)) return error.userMessage;

  return getUserFacingErrorMessage(error, 'An unexpected error occurred. Please try again.');
}

/**
 * Get a user-friendly success message for common actions.
 */
export function getSuccessMessage(action: string, entity: string): string {
  const messages: Record<string, string> = {
    create: `${entity} created successfully.`,
    update: `${entity} updated successfully.`,
    delete: `${entity} deleted successfully.`,
    invite: `Invitation sent to user successfully.`,
    assign: `Assigned successfully.`,
    resolve: `Incident resolved successfully.`,
    acknowledge: `Incident acknowledged successfully.`,
  };

  return messages[action.toLowerCase()] || `${action} completed successfully.`;
}
