import { createHash } from 'node:crypto';
import { canonicalizeLabels } from './labels';
import { maskVolatileText } from './text';
import { normalizeSeverity } from '@/lib/integrations/normalization';

/** Bounded, provider-neutral metadata. No database, model or network dependency. */
export function normalizeAlertShape(input: {
  summary: string;
  severity?: string;
  custom_details?: unknown;
}) {
  const labels = canonicalizeLabels(input.custom_details);
  const resourceKeys = [
    'resource',
    'resource.name',
    'instance',
    'host',
    'hostname',
    'component',
    'pod',
    'labels.instance',
    'labels.resource',
  ];
  const resourceKey =
    resourceKeys
      .map(key => Object.entries(labels).find(([name]) => name === key)?.[1])
      .find(Boolean) ?? null;
  const template = maskVolatileText(input.summary);
  return {
    severity: normalizeSeverity(input.severity?.slice(0, 128)),
    resourceKey,
    labels,
    fingerprintHash: template
      ? createHash('sha256').update(template, 'utf8').digest('hex').slice(0, 32)
      : null,
  };
}
