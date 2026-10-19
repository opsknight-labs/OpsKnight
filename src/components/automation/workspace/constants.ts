import type { Rule } from '@/lib/automation/contract';
import type { Area } from '../presentation-types';

export const controlClass =
  'h-10 max-w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export const AREAS: ReadonlyArray<{ id: Area; label: string; description: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Readiness, Shadow comparison and recent evaluations for the published version.',
  },
  {
    id: 'context',
    label: 'Context',
    description: 'Canonical fields extracted from alert payloads and provider data.',
  },
  {
    id: 'rules',
    label: 'Rules',
    description: 'Ordered enrichment and routing rules applied to every new alert.',
  },
  {
    id: 'test',
    label: 'Test',
    description:
      'Run a sample through the current draft. No incidents or notifications are created.',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Published versions. Compare any version with the active one or restore it.',
  },
];

export const DRAFT_AREAS: ReadonlyArray<Area> = ['context', 'rules', 'test'];

export const draftStorageKey = (serviceId: string) => `automation-draft:${serviceId}`;

export const defaultSample = JSON.stringify(
  {
    event_action: 'trigger',
    dedup_key: 'sample',
    payload: {
      summary: 'Example alert',
      source: 'sample',
      severity: 'error',
      custom_details: { environment: 'prd' },
    },
  },
  null,
  2
);

export const defaultProviderSample = '{"environment":"prd"}';

export function newRule(phase: Rule['phase']): Rule {
  return {
    id: crypto.randomUUID(),
    name: 'New rule',
    phase,
    enabled: true,
    conditions: [],
    actions:
      phase === 'ENRICH'
        ? [{ type: 'SET_PRIORITY', value: 'P1' }]
        : [{ type: 'USE_SERVICE_DEFAULT' }],
  };
}
