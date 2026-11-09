import { createHash } from 'node:crypto';
import type { NoiseControlDefinition, NoiseControlModeValue, OrchestrationRule } from './contract';

/**
 * Versioning for noise-control policies, modelled on `src/lib/automation/versioning.ts`: every save
 * publishes an immutable version, a rollback publishes a clone of an earlier version (history is never
 * rewritten), and pre-paging decisions carry the id of the version they were evaluated against. This
 * module holds the pure parts (checksum, diff) so they can be tested without a database.
 */

export const NOISE_VERSION_ORIGINS = ['PUBLISH', 'ROLLBACK', 'BACKFILL'] as const;
export type NoiseVersionOrigin = (typeof NOISE_VERSION_ORIGINS)[number];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)])
    );
  return value;
}

/** Own-property read without dynamic bracket access. */
function field(source: unknown, key: string): unknown {
  return source && typeof source === 'object' && Object.hasOwn(source, key)
    ? (Reflect.get(source, key) as unknown)
    : undefined;
}

/** sha256 over the key-sorted JSON of mode + definition: equal content gives an equal checksum. */
export function noiseVersionChecksum(
  mode: NoiseControlModeValue,
  definition: NoiseControlDefinition | unknown
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical({ mode, definition })))
    .digest('hex');
}

export interface NoiseVersionDiffEntry {
  /** Dotted path, e.g. `mode`, `storm.threshold`, `orchestration.rules[drop-debug]`. */
  path: string;
  kind: 'added' | 'removed' | 'changed' | 'reordered';
  summary: string;
  before?: unknown;
  after?: unknown;
}

const SECTIONS = ['contentDedup', 'flapping', 'storm'] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function rulesOf(
  definition: Partial<NoiseControlDefinition> | null | undefined
): OrchestrationRule[] {
  const rules = definition?.orchestration?.rules;
  return Array.isArray(rules) ? rules : [];
}

/**
 * Operator-readable differences between two versions: mode, top-level flags, each tuning section field by
 * field, and orchestration rules by stable id (added, removed, changed field by field, order).
 */
export function diffNoiseControlVersions(
  before: { mode: NoiseControlModeValue; definition: Partial<NoiseControlDefinition> | null },
  after: { mode: NoiseControlModeValue; definition: Partial<NoiseControlDefinition> | null }
): NoiseVersionDiffEntry[] {
  const changes: NoiseVersionDiffEntry[] = [];
  if (before.mode !== after.mode)
    changes.push({
      path: 'mode',
      kind: 'changed',
      summary: `Mode ${before.mode} → ${after.mode}`,
      before: before.mode,
      after: after.mode,
    });
  const a = (before.definition ?? {}) as Record<string, unknown>;
  const b = (after.definition ?? {}) as Record<string, unknown>;
  if (!same(a.allowHighUrgency, b.allowHighUrgency))
    changes.push({
      path: 'allowHighUrgency',
      kind: 'changed',
      summary: `Allow high urgency ${String(a.allowHighUrgency ?? false)} → ${String(b.allowHighUrgency ?? false)}`,
      before: a.allowHighUrgency,
      after: b.allowHighUrgency,
    });
  for (const section of SECTIONS) {
    const left = new Map(Object.entries((field(a, section) ?? {}) as Record<string, unknown>));
    const right = new Map(Object.entries((field(b, section) ?? {}) as Record<string, unknown>));
    for (const key of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const was = left.get(key);
      const now = right.get(key);
      if (same(was, now)) continue;
      changes.push({
        path: `${section}.${key}`,
        kind: 'changed',
        summary: `${section}.${key} ${JSON.stringify(was ?? null)} → ${JSON.stringify(now ?? null)}`,
        before: was,
        after: now,
      });
    }
  }
  const previous = rulesOf(before.definition);
  const next = rulesOf(after.definition);
  for (const rule of previous) {
    const updated = next.find(candidate => candidate.id === rule.id);
    const path = `orchestration.rules[${rule.id}]`;
    if (!updated) {
      changes.push({ path, kind: 'removed', summary: `Rule removed: ${rule.name}`, before: rule });
      continue;
    }
    if (same(rule, updated)) continue;
    const fields = (['name', 'enabled', 'conditions', 'actions'] as const).filter(
      key => !same(field(rule, key), field(updated, key))
    );
    changes.push({
      path,
      kind: 'changed',
      summary: `Rule changed: ${updated.name} (${fields.join(', ') || 'details'})`,
      before: rule,
      after: updated,
    });
  }
  for (const rule of next)
    if (!previous.some(candidate => candidate.id === rule.id))
      changes.push({
        path: `orchestration.rules[${rule.id}]`,
        kind: 'added',
        summary: `Rule added: ${rule.name}`,
        after: rule,
      });
  const kept = (rules: OrchestrationRule[], other: OrchestrationRule[]) =>
    rules.filter(rule => other.some(candidate => candidate.id === rule.id)).map(rule => rule.id);
  const order = { before: kept(previous, next), after: kept(next, previous) };
  if (order.before.join('|') !== order.after.join('|'))
    changes.push({
      path: 'orchestration.rules',
      kind: 'reordered',
      summary: 'Rule order changed (rules run top to bottom)',
      before: order.before,
      after: order.after,
    });
  return changes;
}
