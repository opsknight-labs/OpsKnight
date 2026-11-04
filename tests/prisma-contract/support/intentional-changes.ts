import { createRequire } from 'node:module';

/**
 * Deliberate, reviewed behaviour changes relative to the Prisma 5.22 goldens.
 * Each entry transforms the *golden* value before comparison and must explain why the
 * new behaviour is correct. Never add an entry just to make a failing upgrade pass.
 */
type IntentionalChange = {
  file: string;
  key: RegExp;
  sincePrismaMajor: number;
  /** Limits a deviation to intermediate, never-released stages. */
  untilPrismaMajor?: number;
  reason: string;
  /** Receives the golden value for the key and the whole golden file. */
  transform: (golden: unknown, file: Record<string, unknown>) => unknown;
};

const require = createRequire(__filename);
const prismaMajor = Number(
  (require('@prisma/client/package.json') as { version: string }).version.split('.')[0]
);

function bytesAsUint8Array(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(bytesAsUint8Array);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (record.t === 'bytes' && record.ctor === 'Buffer') return { ...record, ctor: 'Uint8Array' };
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, bytesAsUint8Array(v)]));
  }
  return value;
}

type Outcome = { ok: boolean; value?: unknown; error?: Record<string, unknown> };

const withError = (golden: unknown, patch: Record<string, unknown>): Outcome => ({
  ...(golden as Outcome),
  error: { ...(golden as Outcome).error, ...patch },
});

/** Classification of a database that cannot be reached or refuses the TLS policy. */
const UNAVAILABLE = {
  ok: false,
  error: {
    sqlState: null,
    retryable: false,
    httpMapping: 'DATABASE_UNAVAILABLE',
    escalation: 'RETRYABLE_FAILURE',
    uniqueFields: null,
  },
};

const LIBPQ_TLS =
  'Prisma 7 connects through node-postgres; OpsKnight applies libpq sslmode semantics ' +
  '(src/lib/db/pg-config.ts). Prisma 5 treated verify-ca/verify-full and unknown modes as ' +
  '"prefer": it never verified certificates and fell back to plaintext. Verification now ' +
  'happens as configured, which is the documented and secure behaviour.';

export const INTENTIONAL_CHANGES: IntentionalChange[] = [
  {
    file: '*',
    key: /.*/,
    sincePrismaMajor: 6,
    reason:
      'Prisma 6 returns Bytes columns and raw bytea values as Uint8Array instead of Buffer ' +
      '(https://pris.ly/d/upgrade-to-v6). Byte content is unchanged; OpsKnight code that needs ' +
      'Buffer APIs converts explicitly at the boundary.',
    transform: bytesAsUint8Array,
  },
  {
    file: 'error-shapes',
    key: /^connect\.recoversAfterTermination$/,
    sincePrismaMajor: 6,
    untilPrismaMajor: 6,
    reason:
      'Prisma 6.19.3 keeps a terminated backend in its Rust pool and returns P1017 for about 15 ' +
      'seconds before reconnecting (Prisma 5 recovers on the next query). Prisma 6 is an ' +
      'intermediate upgrade stage that is never released; Prisma 7 (node-postgres pool) must ' +
      'recover immediately, so this exception does not apply from major 7.',
    transform: () => false,
  },
  {
    file: 'error-shapes',
    key: /^connect\.terminatedNextQuery$/,
    sincePrismaMajor: 7,
    reason:
      'node-postgres evicts an idle connection as soon as the server terminates it, so the next ' +
      'query runs on a fresh connection instead of failing once as it did with Prisma 5.',
    transform: () => ({ ok: true, value: 'ok' }),
  },
  {
    file: 'error-shapes',
    key: /^connect\.(authFailed|refusedModel|refusedRaw|unknownDatabase)$/,
    sincePrismaMajor: 7,
    reason:
      'Prisma 5 reported a failed *first* connection as an uncoded PrismaClientInitializationError, ' +
      'which the escalation classifier treated as terminal; later outages were P1001 and already ' +
      'retryable. Prisma 7 reports every connection failure with a code, and escalation steps now ' +
      'retry consistently instead of permanently failing during a database outage.',
    transform: golden => withError(golden, { escalation: 'RETRYABLE_FAILURE' }),
  },
  {
    file: 'session-pooling',
    key: /\.configured$|\.bare$|\.operatorOptions$|\.schemaPublic$/,
    sincePrismaMajor: 7,
    reason:
      'Every connection now runs with TimeZone=UTC (src/lib/db/pg-config.ts) because driver ' +
      'adapters send DateTime parameters as UTC wall-clock values; this removes the Prisma 5 ' +
      'raw-SQL time-zone defects on non-UTC servers (see timezone.json).',
    transform: golden => {
      const outcome = golden as Outcome & { value?: Record<string, unknown> };
      return { ...outcome, value: { ...outcome.value, timeZone: 'UTC' } };
    },
  },
  {
    file: 'timezone',
    key: /^asiaKolkata(Pgbouncer)?$/,
    sincePrismaMajor: 7,
    reason:
      'With a UTC session, results on a server whose default TimeZone is Asia/Kolkata are ' +
      'identical to a UTC server (Prisma 5 missed rows and shifted raw writes by +05:30).',
    transform: (_golden, file) => file.utc,
  },
  {
    file: 'tls',
    key: /^(plain\.verifyFull|tls\.(requireWithUntrustedRootCert|verifyCaUntrustedCa|verifyFullNoRootCert|verifyFullUntrustedCa|verifyFullWrongHost))$/,
    sincePrismaMajor: 7,
    reason: LIBPQ_TLS,
    transform: () => UNAVAILABLE,
  },
  {
    file: 'tls',
    key: /^tls\.requireTrustedCaStrict$/,
    sincePrismaMajor: 7,
    reason: `${LIBPQ_TLS} Prisma's sslaccept=strict now verifies a correctly signed certificate.`,
    transform: () => ({ ok: true, value: { ssl: true } }),
  },
  {
    file: 'tls',
    key: /^tls\.requireUntrustedCaStrict$/,
    sincePrismaMajor: 7,
    reason: 'Certificate rejections are classified as database-unavailable and retryable.',
    transform: golden => withError(golden, { escalation: 'RETRYABLE_FAILURE' }),
  },
  {
    file: 'tls',
    key: /^tls\.disable$/,
    sincePrismaMajor: 7,
    reason:
      'A plaintext connection rejected by pg_hba.conf is reported with its SQLSTATE (28000) and ' +
      'classified as database-unavailable and retryable.',
    transform: golden => withError(golden, { sqlState: '28000', escalation: 'RETRYABLE_FAILURE' }),
  },
  {
    file: 'tls',
    key: /^tls\.unknownMode$/,
    sincePrismaMajor: 7,
    reason: `${LIBPQ_TLS} An unknown sslmode is a configuration error and fails closed.`,
    transform: () => ({
      ok: false,
      error: {
        sqlState: null,
        retryable: false,
        httpMapping: 'unmapped',
        escalation: 'TERMINAL_FAILURE',
        uniqueFields: null,
      },
    }),
  },
];

export function applyIntentionalChanges(
  file: string,
  key: string,
  golden: unknown,
  goldenFile: Record<string, unknown> = {}
): unknown {
  return INTENTIONAL_CHANGES.filter(
    change =>
      (change.file === '*' || change.file === file) &&
      change.key.test(key) &&
      prismaMajor >= change.sincePrismaMajor &&
      prismaMajor <= (change.untilPrismaMajor ?? Number.POSITIVE_INFINITY)
  ).reduce((value, change) => change.transform(value, goldenFile), golden);
}
