import { AppError } from '@/lib/errors';

export const MIN_RESOLUTION_NOTE_LENGTH = 10;
export const MAX_RESOLUTION_NOTE_LENGTH = 1000;

/**
 * The mandatory resolution note for an operator who resolves an incident. Shared by the web
 * action, bulk resolve and REST PATCH so no surface can resolve without explaining how.
 */
export function requireResolutionNote(resolution: string | null | undefined): string {
  const trimmed = resolution?.trim();
  if (!trimmed || trimmed.length < MIN_RESOLUTION_NOTE_LENGTH) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage:
        'Resolution note must be at least 10 characters. Please provide more details about how the incident was resolved.',
      fields: [
        {
          field: 'resolution',
          code: 'too_short',
          message: 'Resolution note must be at least 10 characters.',
        },
      ],
      details: { minLength: MIN_RESOLUTION_NOTE_LENGTH },
    });
  }
  if (trimmed.length > MAX_RESOLUTION_NOTE_LENGTH) {
    throw new AppError({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage:
        'Resolution note must be 1000 characters or fewer. Please shorten your description.',
      fields: [
        {
          field: 'resolution',
          code: 'too_long',
          message: 'Resolution note must be 1000 characters or fewer.',
        },
      ],
      details: { maxLength: MAX_RESOLUTION_NOTE_LENGTH },
    });
  }
  return trimmed;
}
