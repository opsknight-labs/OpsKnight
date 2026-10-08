import { emptySnapshot, type Snapshot } from '@/lib/automation/contract';
export const AUTOMATION_LOAD_PROFILES = [
  'global-off',
  'service-disabled',
  'disabled',
  'shadow-small',
  'live-small',
  'live-medium',
  'live-worst',
] as const;
export type AutomationLoadProfile = (typeof AUTOMATION_LOAD_PROFILES)[number];
export function automationLoadSnapshot(profile: AutomationLoadProfile): Snapshot {
  if (['global-off', 'service-disabled', 'disabled'].includes(profile)) return emptySnapshot;
  const count = profile === 'live-worst' ? 100 : profile === 'live-medium' ? 50 : 25;
  const worst = profile === 'live-worst';
  return {
    schemaVersion: 1,
    fields: Array.from({ length: worst ? 64 : 1 }, (_, index) => ({
      fieldId: `field${index}`,
      key: `field${index}`,
      label: `Field ${index}`,
      type: 'NUMBER' as const,
      caseSensitive: false,
      aliases: {},
      mappings: [{ source: 'EVENT' as const, path: 'payload.custom_details.value' }],
    })),
    rules: Array.from({ length: count }, (_, index) => ({
      id: `rule${index}`,
      name: `Rule ${index}`,
      phase: 'ENRICH' as const,
      enabled: true,
      conditions: Array.from({ length: worst ? 20 : 1 }, (_, condition) => ({
        fieldKey: `field${worst ? condition : 0}`,
        operator: 'GTE' as const,
        value: 0,
      })),
      actions: worst
        ? Array.from({ length: 8 }, (_, action) => ({
            type: 'ADD_TAG' as const,
            value: `automation-load-${action}`,
          }))
        : [{ type: 'SET_PRIORITY' as const, value: 'P2' as const }],
    })),
  };
}
