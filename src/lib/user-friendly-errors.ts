/**
 * Compatibility formatter for UI surfaces that still consume string messages.
 *
 * Domain meaning must come from AppError codes, never from matching English
 * exception text. Explicit strings are treated as already-public UI copy;
 * unknown Error objects are intentionally collapsed to a generic message.
 */
import { ERROR_REGISTRY, isAppError } from './errors';

const GENERIC_ERROR = ERROR_REGISTRY.INTERNAL_ERROR.userMessage;

export function getUserFriendlyError(error: string | Error | unknown): string {
  if (isAppError(error)) {
    return error.userMessage;
  }

  // Plain strings are an explicit compatibility contract from callers that
  // already chose the public copy. Do not derive different semantics from it.
  if (typeof error === 'string') {
    return error.trim() || GENERIC_ERROR;
  }

  // Error instances, Event objects, Prisma errors, provider errors, and other
  // unknown values are not trusted for direct display.
  return GENERIC_ERROR;
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
