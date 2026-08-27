/**
 * User-friendly error message translations.
 *
 * @deprecated New domain code should throw AppError with a stable error code.
 * This helper remains as a compatibility bridge while legacy string callers migrate.
 */
import { isAppError } from './errors';

const GENERIC_ERROR = 'An unexpected error occurred. Please try again.';

function translateLegacyMessage(errorMessage: string): string | undefined {
  // Database/Prisma errors. These are legacy compatibility rules only; new
  // code should map structured Prisma error codes at the domain boundary.
  if (errorMessage.includes('Unique constraint')) {
    if (errorMessage.includes('email')) {
      return 'A user with this email already exists. Please use a different email address.';
    }
    if (errorMessage.includes('key')) {
      return 'This key is already in use. Please choose a different one.';
    }
    return 'This value already exists. Please use a different value.';
  }

  if (errorMessage.includes('Foreign key constraint')) {
    return 'The selected item is invalid or no longer exists. Please refresh the page and try again.';
  }

  if (errorMessage.includes('Record to update does not exist')) {
    return 'The item you are trying to update does not exist. It may have been deleted.';
  }

  if (errorMessage.includes('required')) {
    return 'Please fill in all required fields.';
  }

  if (errorMessage.includes('Invalid') || errorMessage.includes('invalid')) {
    return 'Please check your input and try again.';
  }

  if (errorMessage.includes('Unauthorized') || errorMessage.includes('unauthorized')) {
    return 'You do not have permission to perform this action. Please contact an administrator if you believe this is an error.';
  }

  if (errorMessage.includes('not found')) {
    return 'The requested item could not be found. It may have been deleted or you may not have access to it.';
  }

  if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
    return 'Unable to connect to the server. Please check your internet connection and try again.';
  }

  if (errorMessage.includes('timeout')) {
    return 'The request took too long to complete. Please try again.';
  }

  if (errorMessage.includes('Internal Server Error') || errorMessage.includes('500')) {
    return 'An unexpected error occurred. Please try again. If the problem persists, contact support.';
  }

  return undefined;
}

export function getUserFriendlyError(error: string | Error | unknown): string {
  if (isAppError(error)) {
    return error.userMessage;
  }

  // Handle Event objects specifically (they stringify to "[object Event]").
  if (error && typeof error === 'object' && 'type' in error && 'target' in error) {
    return GENERIC_ERROR;
  }

  // Unexpected Error instances are untrusted. Preserve translations for known
  // legacy errors, but never expose an unmatched exception message to users.
  if (error instanceof Error) {
    return translateLegacyMessage(error.message) ?? GENERIC_ERROR;
  }

  const errorString = String(error);
  if (errorString.startsWith('[object ') && errorString.endsWith(']')) {
    return GENERIC_ERROR;
  }

  // Plain strings are still treated as intentionally user-facing legacy input.
  // New code should use AppError instead so semantic meaning does not depend on text.
  return translateLegacyMessage(errorString) ?? errorString;
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
