import { beforeEach, expect, it, vi } from 'vitest';
import { emptySnapshot } from '@/lib/automation/contract';
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  alert: vi.fn(),
  versionList: vi.fn(),
  versionOne: vi.fn(),
  versionSelected: vi.fn(),
  observation: vi.fn(),
  trace: vi.fn(),
}));
vi.mock('@/lib/automation/access', () => ({ assertAutomationAccess: mocks.access }));
vi.mock('@/lib/automation/runtime', () => ({ automationEnabled: vi.fn(async () => true) }));
vi.mock('@/lib/prisma', () => ({
  default: {
    serviceAutomationConfig: {
      findUnique: vi.fn(async () => ({ mode: 'SHADOW', activeVersionId: 'active' })),
    },
    automationDraft: {
      findUnique: vi.fn(async () => ({
        revision: 1,
        snapshot: { schemaVersion: 1, fields: [], rules: [] },
      })),
    },
    automationVersion: {
      findMany: mocks.versionList,
      findUnique: mocks.versionOne,
      findFirst: mocks.versionSelected,
      count: vi.fn(async () => 1),
    },
    automationContextObservation: { findMany: mocks.observation },
    automationShadowAggregate: { findMany: vi.fn(async () => []) },
    automationTrace: { findMany: mocks.trace },
    escalationPolicy: { findMany: vi.fn(async () => []) },
    slackDestination: { findMany: vi.fn(async () => []) },
    microsoftTeamsDestination: { findMany: vi.fn(async () => []) },
    integration: { findMany: vi.fn(async () => []) },
    alert: { findMany: mocks.alert },
    user: { findMany: vi.fn(async () => []) },
  },
}));
import {
  getAutomationArea,
  getAutomationVersionSnapshot,
} from '@/app/(app)/services/[id]/automation/actions';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ id: 'reader', role: 'AUDITOR' });
  mocks.versionOne.mockResolvedValue({ id: 'active', versionNumber: 1, snapshot: emptySnapshot });
  mocks.versionList.mockResolvedValue([]);
  mocks.observation.mockResolvedValue([
    { fieldKey: 'environment', rawValuePreview: 'customer-private' },
  ]);
  mocks.trace.mockResolvedValue([
    { detail: { shadowDifferent: true, normalization: ['customer-private'] } },
  ]);
  mocks.alert.mockResolvedValue([{ payload: { source: 'customer-private' } }]);
});
it('does not query stored alert payloads for readers without sensitive incident access', async () => {
  const area = await getAutomationArea('service-a', 'test');
  expect(area.canReadSensitive).toBe(false);
  expect(area.alerts).toEqual([]);
  expect(mocks.alert).not.toHaveBeenCalled();
});
it('redacts observation previews and diagnostic trace values for Auditors', async () => {
  const context = await getAutomationArea('service-a', 'context');
  expect(context.observations[0].rawValuePreview).toBe('[redacted]');
  const trace = await getAutomationArea('service-a', 'trace');
  expect(trace.traces[0].detail).toEqual({ redacted: true, shadowDifferent: true });
  expect(JSON.stringify(trace)).not.toContain('customer-private');
});
it('allows stored samples for Responders with sensitive incident access', async () => {
  mocks.access.mockResolvedValue({ id: 'responder', role: 'RESPONDER' });
  expect((await getAutomationArea('service-a', 'test')).alerts).toHaveLength(1);
});
it('fetches metadata without full snapshots for version history', async () => {
  await getAutomationArea('service-a', 'activity');
  expect(mocks.versionList).toHaveBeenCalledWith(
    expect.objectContaining({
      select: {
        id: true,
        versionNumber: true,
        publishedAt: true,
        publishedBy: true,
        checksum: true,
        sourceVersionId: true,
      },
    })
  );
});
it('scopes selected snapshots to the service and rejects corrupt stored data', async () => {
  mocks.versionSelected.mockResolvedValue({ versionNumber: 14, snapshot: { corrupt: true } });
  await expect(getAutomationVersionSnapshot('service-a', 'version-a')).rejects.toThrow(
    'Version 14 failed integrity validation'
  );
  expect(mocks.versionSelected).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'version-a', serviceId: 'service-a' } })
  );
});
it('recalculates unmapped readiness after a new active alias handles an older observation', async () => {
  mocks.versionOne.mockResolvedValue({
    id: 'active',
    versionNumber: 2,
    snapshot: {
      ...emptySnapshot,
      fields: [
        {
          fieldId: 'env',
          key: 'environment',
          label: 'Environment',
          type: 'ENUM',
          allowedValues: ['Production'],
          aliases: { prd: 'Production' },
          mappings: [],
        },
      ],
    },
  });
  mocks.observation.mockResolvedValue([
    { fieldKey: 'environment', rawValuePreview: 'prd', unmapped: true },
  ]);
  const overview = await getAutomationArea('service-a', 'overview');
  expect(overview.unmappedCount).toBe(0);
  expect(overview.activeVersion?.snapshot).toBeUndefined();
});
