import {
  ERROR_REGISTRY,
  type AppErrorCode,
  type ErrorDefinition,
  type ErrorField,
} from '@/lib/errors';
import { ClientAppError, extractStructuredError } from '@/lib/client-error';

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

function isTechnicalMessage(message: string): boolean {
  return TECHNICAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function legacyPublicText(error: unknown): string {
  if (typeof error === 'string') return error.trim();

  // ClientAppError is created from the public REST/server-action wire contract,
  // so an untyped legacy `error` field remains displayable during compatibility
  // cleanup. Arbitrary Error.message values are not trusted.
  if (error instanceof ClientAppError) return error.message.trim();

  if (error && typeof error === 'object' && 'error' in error) {
    const value = (error as { error?: unknown }).error;
    return typeof value === 'string' ? value.trim() : '';
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
  // Stable machine-readable semantics always win. Untyped values below are
  // compatibility display only; they never determine auth/conflict/network/etc.
  const typed = typedUserFacingError(error, fallback);
  if (typed) return typed;

  const message = legacyPublicText(error);
  if (message && !isTechnicalMessage(message)) {
    return { title: message };
  }

  return { title: "We couldn't complete that action", description: fallback };
}

export function getUserFacingErrorMessage(error: unknown, fallback?: string): string {
  return toUserFacingError(error, fallback).title;
}
