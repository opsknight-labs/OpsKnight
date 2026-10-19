import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), config: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  default: {
    systemSettings: { findUnique: mocks.settings },
    serviceAutomationConfig: { findUnique: mocks.config },
  },
}));

import { getServiceAutomationContextFields } from '@/lib/automation/context-fields';

const field = (key: string, extra: Record<string, unknown> = {}) => ({
  fieldId: key,
  key,
  label: key[0].toUpperCase() + key.slice(1),
  type: 'STRING',
  caseSensitive: false,
  aliases: {},
  mappings: [],
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({
    automationEnabled: true,
    automationTraceRetentionDays: 90,
    automationSettingsRevision: 1,
  });
});

it('returns builtins then declared fields of the active version without duplicates', async () => {
  mocks.config.mockResolvedValue({
    mode: 'LIVE',
    activeVersion: {
      versionNumber: 3,
      snapshot: {
        schemaVersion: 1,
        rules: [],
        fields: [
          field('environment'),
          field('tier', { type: 'ENUM', caseSensitive: true, allowedValues: ['gold', 'silver'] }),
        ],
      },
    },
  });
  const result = await getServiceAutomationContextFields('service-1');
  expect(result.mode).toBe('LIVE');
  expect(result.versionNumber).toBe(3);
  expect(result.fields.map(item => item.key)).toEqual([
    'priority',
    'urgency',
    'severity',
    'integration',
    'source',
    'environment',
    'tier',
  ]);
  expect(result.fields.find(item => item.key === 'priority')).toMatchObject({
    type: 'ENUM',
    allowedValues: ['P1', 'P2', 'P3', 'P4', 'P5'],
  });
  expect(result.fields.find(item => item.key === 'tier')).toEqual({
    key: 'tier',
    label: 'Tier',
    type: 'ENUM',
    caseSensitive: true,
    allowedValues: ['gold', 'silver'],
  });
  expect(result.fields.find(item => item.key === 'environment')).not.toHaveProperty(
    'allowedValues'
  );
});

it('reports DISABLED when automation is globally switched off', async () => {
  mocks.settings.mockResolvedValue(null);
  mocks.config.mockResolvedValue({ mode: 'LIVE', activeVersion: null });
  const result = await getServiceAutomationContextFields('service-1');
  expect(result).toMatchObject({ mode: 'DISABLED', versionNumber: null });
  expect(result.fields).toHaveLength(5);
});

it('falls back to builtins when the stored snapshot fails validation', async () => {
  mocks.config.mockResolvedValue({
    mode: 'SHADOW',
    activeVersion: { versionNumber: 9, snapshot: { schemaVersion: 2 } },
  });
  const result = await getServiceAutomationContextFields('service-1');
  expect(result.mode).toBe('SHADOW');
  expect(result.versionNumber).toBe(9);
  expect(result.fields.map(item => item.key)).toEqual([
    'priority',
    'urgency',
    'severity',
    'integration',
    'source',
  ]);
});

it('treats services without automation config as DISABLED', async () => {
  mocks.config.mockResolvedValue(null);
  expect(await getServiceAutomationContextFields('service-1')).toMatchObject({
    mode: 'DISABLED',
    versionNumber: null,
  });
});
