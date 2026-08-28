import {
  ERROR_REGISTRY,
  type AppErrorCode,
  type ErrorDefinition,
  type ErrorField,
} from '@/lib/errors';
import { extractStructuredError } from '@/lib/client-error';

export type UserFacingError = {
  title: string;
  description?: string;
  code?: AppErrorCode;
  action?: string;
  retryable?: boolean;
  fields?: ErrorField[];
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

const GENERIC_AUTHORIZATION_CODES = new Set<AppErrorCode>([
  'AUTHORIZATION_DENIED',
  'INCIDENT_ACCESS_DENIED',
  'INCIDENT_MODIFY_DENIED',
  'INCIDENT_CREATE_SERVICE_ACCESS_DENIED',
  'SERVICE_ACCESS_DENIED',
  'SCHEDULE_ACCESS_DENIED',
  'SCHEDULE_OVERRIDE_ACCESS_DENIED',
]);

function errorText(error: unknown): string {
  if (typeof error === 'string') return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === 'object' && 'error' in error) {
    return errorText((error as { error?: unknown }).error);
  }
  return '';
}

function typedUserFacingError(
  error: unknown,
  fallback: string
): UserFacingError | undefined {
  const structured = extractStructuredError(error);
  if (!structured?.code) return undefined;

  const definition: ErrorDefinition = ERROR_REGISTRY[structured.code];
  const message = structured.error || definition.userMessage;
  const action = structured.action || definition.action;
  const retryable = structured.retryable ?? definition.retryable ?? false;
  const metadata = {
    code: structured.code,
    action,
    retryable,
    fields: structured.fields,
  };

  if (structured.code === 'AUTHENTICATION_REQUIRED' || structured.code === 'SESSION_REVOKED') {
    return {
      title: 'Your session has expired',
      description: action || 'Sign in again, then retry the action.',
      ...metadata,
    };
  }

  if (structured.code === 'USER_DISABLED') {
    return {
      title: message,
      description: action,
      ...metadata,
    };
  }

  if (definition.category === 'authorization' && GENERIC_AUTHORIZATION_CODES.has(structured.code)) {
    return {
      title: 'You do not have permission to do that',
      description:
        action ||
        message ||
        'Ask an administrator for access, or sign in with an account that has permission.',
      ...metadata,
    };
  }

  if (definition.category === 'rate_limit') {
    return {
      title: 'Too many requests',
      description: action || message,
      ...metadata,
    };
  }

  if (definition.category === 'dependency' || definition.category === 'network') {
    return {
      title: 'Service temporarily unavailable',
      description: action || message,
      ...metadata,
    };
  }

  if (definition.category === 'internal') {
    return {
      title: "We couldn't complete that action",
      description: action || fallback,
      ...metadata,
    };
  }

  return {
    title: message,
    description: action,
    ...metadata,
  };
}

export function toUserFacingError(
  error: unknown,
  fallback = 'Please try again. If the problem continues, contact an administrator.'
): UserFacingError {
  // Stable machine-readable semantics always win. Regex/string inference below
  // is retained only as a compatibility bridge for legacy/untyped failures.
  const typed = typedUserFacingError(error, fallback);
  if (typed) return typed;

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
