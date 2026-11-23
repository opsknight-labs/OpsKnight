/* eslint-disable security/detect-non-literal-fs-filename -- golden paths are built from a constant directory and fixed spec names */
/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, expect } from 'vitest';
import { applyIntentionalChanges } from './intentional-changes';

const MODE = process.env.PRISMA_CONTRACT_MODE === 'record' ? 'record' : 'verify';
const GOLDEN_DIR = path.resolve(__dirname, '../__golden__');
// Record elsewhere to compare a candidate against the committed goldens without touching them.
const RECORD_DIR = process.env.PRISMA_CONTRACT_RECORD_DIR ?? GOLDEN_DIR;

/**
 * Golden observations for one spec file. In record mode observations are written on
 * completion; in verify mode each observation is compared immediately and every golden
 * key must be exercised, so a silently skipped scenario fails the run.
 */
export function goldenFile(name: string) {
  const file = path.join(GOLDEN_DIR, `${name}.json`);
  const recordFile = path.join(RECORD_DIR, `${name}.json`);
  const recorded: Record<string, unknown> = {};
  const seen = new Set<string>();
  const golden: Record<string, unknown> =
    MODE === 'verify' && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};

  afterAll(() => {
    if (MODE === 'record') {
      fs.mkdirSync(RECORD_DIR, { recursive: true });
      const sorted = Object.fromEntries(
        Object.keys(recorded)
          .sort()
          .map(k => [k, recorded[k]])
      );
      fs.writeFileSync(recordFile, `${JSON.stringify(sorted, null, 2)}\n`);
      return;
    }
    const missing = Object.keys(golden).filter(key => !seen.has(key));
    expect(missing, `golden keys in ${name}.json that were not exercised`).toEqual([]);
  });

  return {
    observe(key: string, value: unknown) {
      const normalized = JSON.parse(JSON.stringify(value ?? null));
      if (MODE === 'record') {
        recorded[key] = normalized;
        return;
      }
      seen.add(key);
      expect(golden, `no golden recorded for ${name}:${key}`).toHaveProperty([key]);
      expect(normalized, `${name}:${key}`).toEqual(
        applyIntentionalChanges(name, key, golden[key], golden)
      );
    },
  };
}
