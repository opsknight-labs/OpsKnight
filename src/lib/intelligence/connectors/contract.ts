import { z } from 'zod/v4';

/**
 * Observability connectors: read-only outbound connections Squire may query during an AI turn. This file is
 * dependency-free so the settings UI can import the kinds, labels and bounds.
 */
export const OBSERVABILITY_KINDS = [
  'PROMETHEUS',
  'LOKI',
  'TEMPO',
  'GRAFANA',
  'DATADOG',
  'ELASTIC',
  'CLOUDWATCH',
  'SENTRY',
  'GITHUB',
  'GITLAB',
] as const;
export type ObservabilityKind = (typeof OBSERVABILITY_KINDS)[number];

/** What a connection can answer. Each Squire tool needs exactly one of these. */
export const CONNECTOR_CAPABILITIES = ['metrics', 'logs', 'traces', 'errors', 'diff'] as const;
export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export const KIND_CAPABILITIES: Readonly<
  Record<ObservabilityKind, readonly ConnectorCapability[]>
> = {
  PROMETHEUS: ['metrics'],
  LOKI: ['logs'],
  TEMPO: ['traces'],
  // Grafana is reached through its data-source proxy: a Prometheus or Loki data source.
  GRAFANA: ['metrics', 'logs'],
  DATADOG: ['metrics', 'logs', 'traces'],
  ELASTIC: ['logs'],
  CLOUDWATCH: ['metrics', 'logs'],
  SENTRY: ['errors'],
  GITHUB: ['diff'],
  GITLAB: ['diff'],
};

const CAPABILITY_LABELS: Readonly<Record<ConnectorCapability, string>> = {
  metrics: 'metrics',
  logs: 'logs',
  traces: 'traces',
  errors: 'error events',
  diff: 'code diffs',
};

/** "metrics, logs" — what a kind of connection can answer, for the settings page. */
export function capabilitySummary(kind: ObservabilityKind): string {
  // eslint-disable-next-line security/detect-object-injection -- capability is a member of the closed union
  return KIND_CAPABILITIES[kind].map(capability => CAPABILITY_LABELS[capability]).join(', ');
}

export const KIND_LABELS: Readonly<Record<ObservabilityKind, string>> = {
  PROMETHEUS: 'Prometheus',
  LOKI: 'Grafana Loki',
  TEMPO: 'Grafana Tempo',
  GRAFANA: 'Grafana (data-source proxy)',
  DATADOG: 'Datadog',
  ELASTIC: 'Elasticsearch',
  CLOUDWATCH: 'Amazon CloudWatch',
  SENTRY: 'Sentry',
  GITHUB: 'GitHub',
  GITLAB: 'GitLab',
};

/** The public endpoint used when an administrator leaves the base URL blank. */
export const KIND_DEFAULT_BASE_URL: Readonly<Partial<Record<ObservabilityKind, string>>> = {
  DATADOG: 'https://api.datadoghq.com',
  SENTRY: 'https://sentry.io',
  GITHUB: 'https://api.github.com',
  GITLAB: 'https://gitlab.com',
};

export const CONNECTOR_BOUNDS = {
  maxConnections: 50,
  timeoutMs: { min: 1_000, max: 30_000, default: 10_000 },
  /** Largest response body read from any connector; larger bodies are rejected unread. */
  maxResponseBytes: 2_000_000,
  /** Default and maximum query windows. */
  defaultWindowMs: 60 * 60_000,
  maxWindowMs: 24 * 60 * 60_000,
  maxAllowedTeams: 100,
} as const;

export const AWS_REGION_PATTERN = /^(?:us-gov|[a-z]{2})-[a-z]+-\d{1,2}$/;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._*,:/-]{0,199}$/;

const optionalText = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .max(200)
    .transform(value => value || null)
    .pipe(z.string().regex(pattern, message).nullable())
    .nullish();

export const observabilityConnectionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    kind: z.enum(OBSERVABILITY_KINDS),
    /** Blank uses the vendor's public endpoint where one exists. */
    baseUrl: z.string().trim().max(500).nullish(),
    /** Token, API key or secret access key. Omitted or empty on update keeps the stored one. Never echoed. */
    secret: z.string().trim().max(4_096).nullish(),
    /** Basic-auth user, Datadog application key or AWS access key id. Stored encrypted with the secret. */
    secondary: z.string().trim().max(512).nullish(),
    region: optionalText(AWS_REGION_PATTERN, 'Not a valid AWS region'),
    org: optionalText(SLUG, 'Use letters, digits, dots, dashes or underscores'),
    project: optionalText(SLUG, 'Use letters, digits, dots, dashes, underscores or wildcards'),
    allowedTeamIds: z
      .array(z.string().trim().min(1).max(64))
      .max(CONNECTOR_BOUNDS.maxAllowedTeams)
      .default([])
      .transform(ids => [...new Set(ids)]),
    allowPrivateNetwork: z.boolean().default(false),
    enabled: z.boolean().default(false),
    timeoutMs: z
      .number()
      .int()
      .min(CONNECTOR_BOUNDS.timeoutMs.min)
      .max(CONNECTOR_BOUNDS.timeoutMs.max)
      .default(CONNECTOR_BOUNDS.timeoutMs.default),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.baseUrl && !KIND_DEFAULT_BASE_URL[value.kind] && value.kind !== 'CLOUDWATCH') {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'A base URL is required' });
    }
    if (value.kind === 'CLOUDWATCH' && !value.region) {
      ctx.addIssue({ code: 'custom', path: ['region'], message: 'An AWS region is required' });
    }
    if (value.kind === 'CLOUDWATCH' && value.allowPrivateNetwork) {
      ctx.addIssue({
        code: 'custom',
        path: ['allowPrivateNetwork'],
        message: 'CloudWatch is reached at its public regional endpoint',
      });
    }
    if (value.kind === 'SENTRY' && !value.org) {
      ctx.addIssue({
        code: 'custom',
        path: ['org'],
        message: 'The Sentry organization is required',
      });
    }
    if (value.kind === 'GRAFANA' && !value.project) {
      ctx.addIssue({
        code: 'custom',
        path: ['project'],
        message: 'The Grafana data source UID is required',
      });
    }
    if (Boolean(value.secret) !== Boolean(value.secondary) && value.kind === 'CLOUDWATCH') {
      ctx.addIssue({
        code: 'custom',
        path: ['secondary'],
        message: 'Enter both the access key ID and the secret access key',
      });
    }
  });
export type ObservabilityConnectionInput = z.infer<typeof observabilityConnectionInputSchema>;

/** What the browser and the audit log may see. The credential itself never leaves the server. */
export interface ObservabilityConnectionView {
  id: string;
  name: string;
  kind: ObservabilityKind;
  baseUrl: string;
  region: string | null;
  org: string | null;
  project: string | null;
  allowedTeamIds: string[];
  allowPrivateNetwork: boolean;
  enabled: boolean;
  timeoutMs: number;
  hasCredential: boolean;
  updatedAt: string;
}

export type ConnectorTestResult =
  | { ok: true; latencyMs: number }
  | {
      ok: false;
      reason:
        | 'NOT_FOUND'
        | 'BLOCKED'
        | 'UNREACHABLE'
        | 'REJECTED'
        | 'TIMEOUT'
        | 'TOO_LARGE'
        | 'FAILED'
        | 'UNSUPPORTED';
    };
