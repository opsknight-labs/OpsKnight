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
  reason: string;
  transform: (golden: unknown) => unknown;
};

const require = createRequire(__filename);
const prismaMajor = Number(
  (require('@prisma/client/package.json') as { version: string }).version.split('.')[0]
);

export const INTENTIONAL_CHANGES: IntentionalChange[] = [];

export function applyIntentionalChanges(file: string, key: string, golden: unknown): unknown {
  return INTENTIONAL_CHANGES.filter(
    change => change.file === file && change.key.test(key) && prismaMajor >= change.sincePrismaMajor
  ).reduce((value, change) => change.transform(value), golden);
}
