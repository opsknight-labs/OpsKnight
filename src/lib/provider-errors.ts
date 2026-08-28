import { NextResponse } from 'next/server';
import { AppError, toPublicAppError } from '@/lib/errors';

export type ProviderName = 'slack' | 'jira' | 'web-push' | string;

export type ProviderFailureInput = {
  provider: ProviderName;
  operation: string;
  providerCode?: string | null;
  status?: number | null;
  cause?: unknown;
};

const AUTHENTICATION_CODES = new Set([
  'invalid_auth',
  'not_authed',
  'token_revoked',
  'account_inactive',
]);

const RETRYABLE_CODES = new Set([
  'ratelimited',
  'rate_limited',
  'internal_error',
  'service_unavailable',
  'temporarily_unavailable',
  'timeout',
]);

function providerLabel(provider: ProviderName): string {
  if (provider === 'slack') return 'Slack';
  if (provider === 'jira') return 'Jira';
  if (provider === 'web-push') return 'Push notification provider';
  return 'External provider';
}

function providerAction(providerCode: string | undefined, label: string): string {
  switch (providerCode) {
    case 'missing_scope':
      return 'Update the provider app scopes and reconnect the integration.';
    case 'not_allowed':
      return 'Check the provider app permissions and workspace policy, then try again.';
    case 'restricted_action':
      return 'Check the provider workspace policy and app permissions.';
    case 'channel_not_found':
      return 'Refresh the channel list and choose an existing channel.';
    case 'not_in_channel':
      return 'Connect the provider app to the channel before trying again.';
    case 'is_archived':
      return 'Choose an active channel and try again.';
    case 'cant_leave_general':
      return 'Choose a channel other than the workspace default channel.';
    default:
      return `Check the ${label} integration configuration and try again.`;
  }
}

/**
 * Convert structured upstream status/code information into AppError semantics.
 * This intentionally never inspects English provider error text.
 */
export function integrationProviderError(input: ProviderFailureInput): AppError {
  const providerCode = input.providerCode?.toLowerCase();
  const label = providerLabel(input.provider);
  const details = {
    provider: input.provider,
    operation: input.operation,
    providerCode: input.providerCode ?? undefined,
    providerStatus: input.status ?? undefined,
  };

  if (
    input.status === 401 ||
    input.status === 403 ||
    (providerCode && AUTHENTICATION_CODES.has(providerCode))
  ) {
    return new AppError({
      code: 'INTEGRATION_AUTHENTICATION_FAILED',
      userMessage: `${label} authentication failed.`,
      action: `Reconnect ${label} or update its credentials, then try again.`,
      retryable: false,
      details,
      cause: input.cause,
    });
  }

  const networkFailure =
    input.cause !== undefined &&
    input.status === undefined &&
    input.providerCode === undefined;

  if (
    networkFailure ||
    input.status === 429 ||
    (input.status !== undefined && input.status !== null && input.status >= 500) ||
    (providerCode && RETRYABLE_CODES.has(providerCode))
  ) {
    // There is not yet a generic integration dependency code in the registry.
    // INTERNAL_ERROR is intentionally retryable and keeps provider details private.
    return new AppError({
      code: 'INTERNAL_ERROR',
      details: { ...details, dependencyUnavailable: true },
      cause: input.cause,
    });
  }

  return new AppError({
    code: 'INTEGRATION_VALIDATION_FAILED',
    userMessage: `${label} rejected the requested operation.`,
    action: providerAction(providerCode, label),
    retryable: false,
    details,
    cause: input.cause,
  });
}

export function notificationProviderUnavailable(input: ProviderFailureInput): AppError {
  return new AppError({
    code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
    details: {
      provider: input.provider,
      operation: input.operation,
      providerCode: input.providerCode ?? undefined,
      providerStatus: input.status ?? undefined,
    },
    cause: input.cause,
  });
}

/**
 * Provider APIs historically exposed their native machine error in `error`.
 * Preserve that field while adding OpsKnight's stable typed contract so old
 * clients remain compatible and new clients can branch on `code`.
 */
export function jsonProviderError(
  error: AppError,
  options: {
    legacyError?: string | null;
    provider: ProviderName;
    providerCode?: string | null;
  }
) {
  const publicError = toPublicAppError(error);
  return NextResponse.json(
    {
      error: options.legacyError || publicError.message,
      code: publicError.code,
      action: publicError.action,
      retryable: publicError.retryable,
      fields: publicError.fields,
      meta: {
        provider: options.provider,
        providerCode: options.providerCode ?? undefined,
      },
    },
    { status: error.status }
  );
}
