export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'dependency'
  | 'network'
  | 'internal';

export type ErrorExposure = 'public' | 'authenticated' | 'internal';

export type ErrorDefinition = {
  status: number;
  category: ErrorCategory;
  userMessage: string;
  action?: string;
  retryable?: boolean;
  exposure?: ErrorExposure;
};

export const ERROR_REGISTRY = {
  INTERNAL_ERROR: {
    status: 500,
    category: 'internal',
    userMessage: 'An unexpected error occurred. Please try again. If the problem persists, contact support.',
    action: 'Try again. If the problem continues, contact support.',
    retryable: true,
    exposure: 'internal',
  },
  VALIDATION_FAILED: {
    status: 400,
    category: 'validation',
    userMessage: 'Please check your input and try again.',
    retryable: false,
    exposure: 'public',
  },
  INVALID_JSON: {
    status: 400,
    category: 'validation',
    userMessage: 'The request body contains invalid JSON.',
    action: 'Correct the request body and try again.',
    retryable: false,
    exposure: 'public',
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    category: 'validation',
    userMessage: 'The request payload is too large.',
    action: 'Reduce the payload size and try again.',
    retryable: false,
    exposure: 'public',
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    category: 'authentication',
    userMessage: 'Authentication is required to continue.',
    action: 'Sign in and try again.',
    retryable: false,
    exposure: 'public',
  },
  API_KEY_INVALID: {
    status: 401,
    category: 'authentication',
    userMessage: 'The API key is missing or invalid.',
    action: 'Provide a valid API key and try again.',
    retryable: false,
    exposure: 'public',
  },
  API_KEY_USER_INVALID: {
    status: 401,
    category: 'authentication',
    userMessage: 'The API key owner is no longer available.',
    action: 'Create or use an API key for an active user.',
    retryable: false,
    exposure: 'public',
  },
  API_SCOPE_REQUIRED: {
    status: 403,
    category: 'authorization',
    userMessage: 'The API key does not include the required scope.',
    action: 'Use an API key with the required scope.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_KEY_INVALID: {
    status: 403,
    category: 'authorization',
    userMessage: 'The integration key is invalid.',
    action: 'Verify the integration key and try again.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_DISABLED: {
    status: 403,
    category: 'authorization',
    userMessage: 'This integration is disabled.',
    action: 'Enable the integration before sending events.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested integration could not be found.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_AUTHENTICATION_FAILED: {
    status: 401,
    category: 'authentication',
    userMessage: 'Integration authentication failed.',
    action: 'Verify the integration credentials and try again.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_SIGNATURE_INVALID: {
    status: 401,
    category: 'authentication',
    userMessage: 'Webhook signature verification failed.',
    action: 'Verify the webhook signing secret and signature.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_SIGNATURE_MISSING: {
    status: 401,
    category: 'authentication',
    userMessage: 'A required webhook signature is missing.',
    action: 'Send the required signature header.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_TIMESTAMP_EXPIRED: {
    status: 401,
    category: 'authentication',
    userMessage: 'The webhook timestamp is outside the allowed window.',
    action: 'Send a fresh webhook request.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_PAYLOAD_INVALID: {
    status: 400,
    category: 'validation',
    userMessage: 'The integration payload is invalid.',
    action: 'Correct the payload and try again.',
    retryable: false,
    exposure: 'public',
  },
  INTEGRATION_VALIDATION_FAILED: {
    status: 400,
    category: 'validation',
    userMessage: 'The integration payload failed validation.',
    action: 'Correct the payload fields and try again.',
    retryable: false,
    exposure: 'public',
  },
  SESSION_REVOKED: {
    status: 401,
    category: 'authentication',
    userMessage: 'Your session is no longer valid.',
    action: 'Sign in again to continue.',
    retryable: false,
    exposure: 'public',
  },
  USER_DISABLED: {
    status: 403,
    category: 'authorization',
    userMessage: 'Your account is disabled.',
    action: 'Contact an administrator if you believe this is an error.',
    retryable: false,
    exposure: 'public',
  },
  AUTHORIZATION_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have permission to perform this action.',
    action: 'Contact an administrator if you believe you should have access.',
    retryable: false,
    exposure: 'public',
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested item could not be found.',
    retryable: false,
    exposure: 'public',
  },
  RATE_LIMIT_EXCEEDED: {
    status: 429,
    category: 'rate_limit',
    userMessage: 'Too many requests were received.',
    action: 'Wait briefly before trying again.',
    retryable: true,
    exposure: 'public',
  },
  INCIDENT_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested incident could not be found.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_ACCESS_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have permission to access this incident.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_MODIFY_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have permission to modify this incident.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_CREATE_SERVICE_ACCESS_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You can only create incidents for services your team can access.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_REQUIRED_FIELDS_MISSING: {
    status: 422,
    category: 'validation',
    userMessage: 'Some required incident information is missing.',
    action: 'Complete the required fields and try again.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_TRANSITION_CONFLICT: {
    status: 409,
    category: 'conflict',
    userMessage: 'The incident status changed before this action completed.',
    action: 'Refresh the incident and try again.',
    retryable: true,
    exposure: 'public',
  },
  INCIDENT_STATE_CONFLICT: {
    status: 409,
    category: 'conflict',
    userMessage: 'The incident state changed before this action completed.',
    action: 'Refresh the incident and try again.',
    retryable: true,
    exposure: 'public',
  },
  INCIDENT_INVALID_TRANSITION: {
    status: 409,
    category: 'conflict',
    userMessage: 'This incident status change is not allowed from the current state.',
    action: 'Refresh the incident and choose a valid action.',
    retryable: false,
    exposure: 'public',
  },
  INCIDENT_INVALID_ARGUMENT: {
    status: 400,
    category: 'validation',
    userMessage: 'The incident update contains invalid input.',
    retryable: false,
    exposure: 'public',
  },
  SERVICE_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested service could not be found.',
    retryable: false,
    exposure: 'public',
  },
  SERVICE_ACCESS_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have access to this service.',
    retryable: false,
    exposure: 'public',
  },
  SCHEDULE_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested schedule could not be found.',
    retryable: false,
    exposure: 'public',
  },
  SCHEDULE_ACCESS_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have permission to access this schedule.',
    retryable: false,
    exposure: 'public',
  },
  SCHEDULE_OVERRIDE_ACCESS_DENIED: {
    status: 403,
    category: 'authorization',
    userMessage: 'You do not have permission to create an override for this schedule.',
    retryable: false,
    exposure: 'public',
  },
  SCHEDULE_LAYER_USER_DUPLICATE: {
    status: 409,
    category: 'conflict',
    userMessage: 'This responder is already assigned to this schedule.',
    action: 'Remove the existing assignment before adding another.',
    retryable: false,
    exposure: 'public',
  },
  STATUS_PAGE_WEBHOOK_NOT_FOUND: {
    status: 404,
    category: 'not_found',
    userMessage: 'The requested status-page webhook could not be found.',
    retryable: false,
    exposure: 'public',
  },
  NOTIFICATION_PROVIDER_UNAVAILABLE: {
    status: 503,
    category: 'dependency',
    userMessage: 'The notification provider is temporarily unavailable.',
    action: 'Try again shortly.',
    retryable: true,
    exposure: 'public',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type AppErrorCode = keyof typeof ERROR_REGISTRY;

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && value in ERROR_REGISTRY;
}
