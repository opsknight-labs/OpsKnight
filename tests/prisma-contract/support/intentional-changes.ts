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
  transform: (golden: unknown) => unknown;
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
];

export function applyIntentionalChanges(file: string, key: string, golden: unknown): unknown {
  return INTENTIONAL_CHANGES.filter(
    change =>
      (change.file === '*' || change.file === file) &&
      change.key.test(key) &&
      prismaMajor >= change.sincePrismaMajor &&
      prismaMajor <= (change.untilPrismaMajor ?? Number.POSITIVE_INFINITY)
  ).reduce((value, change) => change.transform(value), golden);
}
