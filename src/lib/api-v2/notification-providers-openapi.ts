type Schema = Record<string, unknown>;
const string = (maxLength?: number): Schema => ({
  type: 'string',
  ...(maxLength ? { maxLength } : {}),
});
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const provider = {
  type: 'string',
  enum: ['twilio', 'aws-sns', 'resend', 'sendgrid', 'smtp', 'ses', 'web-push'],
};
const maskedConfig = {
  type: 'object',
  additionalProperties: true,
  description:
    'Secrets are replaced with a mask and accompanied by has<Field> booleans. Web Push private key history is never returned.',
};

export const NOTIFICATION_PROVIDER_SCHEMAS: Record<string, Schema> = {
  NotificationProvider: object(
    {
      id: string(),
      provider,
      enabled: { type: 'boolean' },
      revision: { type: 'integer', minimum: 1 },
      config: maskedConfig,
      configurationState: {
        type: 'string',
        enum: ['READY', 'INCOMPLETE', 'DISABLED', 'DECRYPTION_ERROR'],
      },
      updatedAt: { type: 'string', format: 'date-time' },
    },
    ['id', 'provider', 'enabled', 'revision', 'config', 'configurationState', 'updatedAt']
  ),
  NotificationProviderDiagnostics: object(
    {
      provider,
      enabled: { type: 'boolean' },
      configurationState: { type: 'string' },
      missingRequiredFields: { type: 'array', items: string() },
      recentTests: {
        type: 'array',
        maxItems: 5,
        items: object(
          {
            id: string(),
            status: string(),
            channel: string(),
            createdAt: { type: 'string', format: 'date-time' },
            errorCode: { type: ['string', 'null'] },
          },
          ['id', 'status', 'channel', 'createdAt', 'errorCode']
        ),
      },
    },
    ['provider', 'enabled', 'configurationState', 'missingRequiredFields', 'recentTests']
  ),
  NotificationProviderTest: object(
    {
      id: string(),
      provider: string(),
      channel: string(),
      status: string(),
      created: { type: 'boolean' },
    },
    ['id', 'provider', 'channel', 'status', 'created']
  ),
  WebPushRotation: object(
    {
      publicKey: string(),
      subject: string(),
      provider: { $ref: '#/components/schemas/NotificationProvider' },
    },
    ['publicKey', 'subject', 'provider']
  ),
};

export const NOTIFICATION_PROVIDER_OPERATIONS = [
  {
    method: 'get',
    path: '/notification-providers',
    summary: 'List safe notification provider configuration metadata',
    description:
      'Administrator-only. Secrets are decrypted only on the server and returned as masks; diagnostics and config responses never include private credential values.',
  },
  {
    method: 'get',
    path: '/notification-providers/{provider}',
    summary: 'Read one provider configuration and its revision',
    description: 'Returns a strong ETag for exact-revision updates. Secret fields are masked.',
  },
  {
    method: 'put',
    path: '/notification-providers/{provider}',
    summary: 'Create or replace a notification provider configuration',
    description:
      'Requires Idempotency-Key. Existing configurations require a concrete If-Match ETag. New configurations omit If-Match. Secrets are encrypted at rest, preserved when omitted or masked, and never returned. Provider mutation, audit and idempotency receipt commit atomically.',
    body: object(
      {
        provider,
        enabled: { type: 'boolean' },
        config: {
          type: 'object',
          additionalProperties: true,
          description: 'Provider-specific strict fields. Secret values are encrypted at rest.',
        },
      },
      ['provider', 'enabled', 'config']
    ),
  },
  {
    method: 'get',
    path: '/notification-providers/{provider}/diagnostics',
    summary: 'Inspect safe provider readiness and recent delivery outcomes',
    description:
      'Returns bounded state and stable provider error codes. It excludes credentials, addresses, transport error messages and payloads.',
  },
  {
    method: 'post',
    path: '/notification-providers/{provider}/test',
    summary: 'Queue an idempotent provider test notification',
    description:
      'Requires Idempotency-Key and the current concrete provider ETag. Queues a durable intent addressed to the active administrator; provider network delivery is performed asynchronously. The response does not reveal the destination.',
    body: object({}),
  },
  {
    method: 'post',
    path: '/notification-providers/web-push/rotate',
    summary: 'Rotate Web Push VAPID keys',
    description:
      'Requires Idempotency-Key and the current concrete provider ETag. The private key is encrypted at rest and never returned. The public key is returned for client subscription migration.',
    body: object(
      {
        subject: { type: 'string', minLength: 1, maxLength: 320 },
        keepPrevious: { type: 'boolean', default: true },
      },
      ['subject']
    ),
  },
] as const;
