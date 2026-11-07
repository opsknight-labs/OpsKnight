import { createHash } from 'node:crypto';
import type { CorrelationRule } from '../contract';

/**
 * Pure, deterministic correlation rules. A rule turns an incident's fingerprint into a signature;
 * incidents with the same signature inside the same window correlate. Nothing here is learned or
 * probabilistic: every match is explainable by the rule that produced it.
 */

export interface CorrelationFingerprint {
  serviceId: string;
  template: string;
  labels: Readonly<Record<string, string>>;
}

const FIELD_SERVICE = 'service';
const FIELD_TEMPLATE = 'template';

function hash(parts: readonly string[]): string {
  // The unit separator cannot appear in masked templates or canonical labels, so joined parts are unambiguous.
  return createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32);
}

function valueFor(fingerprint: CorrelationFingerprint, key: string): string | null {
  if (key === FIELD_SERVICE) return fingerprint.serviceId;
  if (key === FIELD_TEMPLATE) return fingerprint.template;
  const value = Object.entries(fingerprint.labels).find(([labelKey]) => labelKey === key)?.[1];
  return value ?? null;
}

/**
 * Signature of an incident under a rule, or null when the rule does not apply (a required field or
 * label is missing, or the template is empty). Missing data never produces a match.
 */
export function computeSignature(
  rule: CorrelationRule,
  fingerprint: CorrelationFingerprint
): string | null {
  if (rule.kind === 'CONTENT_TEMPLATE' || (rule.kind === 'TOPOLOGY' && rule.keys.length === 0)) {
    return fingerprint.template.length > 0 ? hash(['template', fingerprint.template]) : null;
  }
  // EXACT_FIELD and LABEL_SET both key on the sorted values of the listed fields; EXACT_FIELD may also
  // name the built-in "service" and "template" fields, LABEL_SET names labels only.
  const keys = [...new Set(rule.keys)].sort();
  const pairs: string[] = [];
  for (const key of keys) {
    if (rule.kind === 'LABEL_SET' && (key === FIELD_SERVICE || key === FIELD_TEMPLATE)) return null;
    const value = valueFor(fingerprint, key);
    if (value === null || value.length === 0) return null;
    pairs.push(`${key}=${value}`);
  }
  return pairs.length > 0 ? hash([rule.kind, ...pairs]) : null;
}

/** Stable identifier of the set of services a group spans. */
export function scopeHash(serviceIds: readonly string[]): string {
  return hash([...new Set(serviceIds)].sort());
}

export interface GroupWindow {
  windowStart: Date;
  windowEnd: Date;
  maxWindowEnd: Date;
}

/** Window bucket containing `at`, derived from the incident time so replays are deterministic. */
export function windowFor(
  at: Date,
  rule: Pick<CorrelationRule, 'windowSeconds' | 'maxWindowSeconds'>
): GroupWindow {
  const size = rule.windowSeconds * 1000;
  const start = Math.floor(at.getTime() / size) * size;
  return {
    windowStart: new Date(start),
    windowEnd: new Date(start + size),
    maxWindowEnd: new Date(start + rule.maxWindowSeconds * 1000),
  };
}

/** Sliding extension: a joining incident keeps the window open, but never beyond the hard ceiling. */
export function extendedWindowEnd(
  current: { windowEnd: Date; maxWindowEnd: Date },
  joinedAt: Date,
  windowSeconds: number
): Date {
  const wanted = Math.max(current.windowEnd.getTime(), joinedAt.getTime() + windowSeconds * 1000);
  return new Date(Math.min(wanted, current.maxWindowEnd.getTime()));
}

/**
 * Critical alerts are never grouped by this engine. Urgency HIGH is the platform's page-immediately
 * class, so anything that would page at the highest urgency stays an independent incident.
 */
export function isCriticalIncident(incident: { urgency: string }): boolean {
  return incident.urgency === 'HIGH';
}
