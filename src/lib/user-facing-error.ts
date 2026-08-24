export type UserFacingError = {
  title: string;
  description?: string;
};

const TECHNICAL_ERROR_PATTERNS = [
  /prisma/i,
  /unique constraint/i,
  /foreign key constraint/i,
  /\bP\d{4}\b/,
  /ECONN(?:REFUSED|RESET)/i,
  /stack trace/i,
  /\bat .+\(.+:\d+:\d+\)/,
];

function errorText(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === 'object' && 'error' in error) {
    return errorText((error as { error?: unknown }).error);
  }
  return '';
}

export function toUserFacingError(
  error: unknown,
  fallback = 'Please try again. If the problem continues, contact an administrator.'
): UserFacingError {
  const message = errorText(error);

  if (!message) {
    return { title: "We couldn't complete that action", description: fallback };
  }

  if (/unauthori[sz]ed|permission|forbidden|access required/i.test(message)) {
    return {
      title: 'You do not have permission to do that',
      description: 'Ask an administrator for access, or sign in with an account that has permission.',
    };
  }

  if (/network|failed to fetch|fetch failed|ECONN(?:REFUSED|RESET)|offline/i.test(message)) {
    return {
      title: 'Connection problem',
      description: 'Check your connection and try again. Your changes may not have been saved.',
    };
  }

  if (/session.*expired|sign in again|authentication/i.test(message)) {
    return {
      title: 'Your session has expired',
      description: 'Sign in again, then retry the action.',
    };
  }

  if (/unique constraint|already exists|duplicate/i.test(message)) {
    return {
      title: 'That item already exists',
      description: TECHNICAL_ERROR_PATTERNS.some(pattern => pattern.test(message))
        ? 'Choose a different value or update the existing item instead.'
        : message,
    };
  }

  if (TECHNICAL_ERROR_PATTERNS.some(pattern => pattern.test(message))) {
    return { title: "We couldn't complete that action", description: fallback };
  }

  return { title: message };
}
