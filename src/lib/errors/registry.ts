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
  AUTHENTICATION_REQUIRED: {
    status: 401,
    category: 'authentication',
    userMessage: 'Authentication is required to continue.',
    action: 'Sign in and try again.',
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
  INCIDENT_REQUIRED_FIELDS_MISSING: {
    status: 400,
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
  SCHEDULE_LAYER_USER_DUPLICATE: {
    status: 409,
    category: 'conflict',
    userMessage: 'This responder is already assigned to this schedule layer.',
    action: 'Remove the existing assignment before adding another.',
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
