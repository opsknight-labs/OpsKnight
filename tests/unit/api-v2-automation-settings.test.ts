import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { authorize, AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { updateAutomationSettings } from '@/lib/automation/settings-command';
import { logAudit } from '@/lib/audit';
import { getAutomationSettings } from '@/lib/automation/settings';

vi.mock('@/lib/automation/settings', () => ({ getAutomationSettings: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

const previous = {
  automationEnabled: true,
  automationStoreObservationPreviews: false,
  automationTraceRetentionDays: 90,
  automationSettingsRevision: 2,
};
function transaction() {
  return {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    automationContextObservation: { updateMany: vi.fn() },
    serviceAutomationConfig: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
    systemSettings: {
      upsert: vi.fn().mockResolvedValue({
        ...previous,
        automationEnabled: false,
        automationSettingsRevision: 3,
      }),
    },
  };
}

describe('automation administrative settings boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAutomationSettings).mockResolvedValue(previous);
  });
  it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
    'denies %s even with the explicit scope',
    role => {
      expect(
        authorize({
          actor: {
            id: 'actor',
            role,
            status: 'ACTIVE',
            teamIds: [],
            apiKey: { id: 'key', scopes: ['automation-settings:write'] },
          },
          action: AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE,
        }).allowed
      ).toBe(false);
    }
  );
  it('requires an explicit scope even for administrators', () => {
    for (const [scopes, allowed] of [
      [['admin:manage'], false],
      [['automation-settings:write'], true],
    ] as const) {
      expect(
        authorize({
          actor: {
            id: 'actor',
            role: 'ADMIN',
            status: 'ACTIVE',
            teamIds: [],
            apiKey: { id: 'key', scopes },
          },
          action: AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE,
        }).allowed
      ).toBe(allowed);
    }
  });
  it('resets modes and attributes one canonical event within the supplied transaction', async () => {
    const tx = transaction();
    await updateAutomationSettings(
      { automationEnabled: false, automationTraceRetentionDays: 90, expectedRevision: 2 },
      { actorId: 'actor', source: 'API', apiClientId: 'key' },
      tx as unknown as Prisma.TransactionClient
    );
    expect(tx.serviceAutomationConfig.updateMany).toHaveBeenCalledWith({
      where: { mode: { not: 'DISABLED' } },
      data: { mode: 'DISABLED', updatedBy: 'actor' },
    });
    expect(logAudit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: 'automation.settings.updated',
        source: 'API',
        details: { apiClientId: 'key' },
      }),
      tx
    );
  });
  it('rejects stale revisions before state or audit changes', async () => {
    const tx = transaction();
    await expect(
      updateAutomationSettings(
        { automationEnabled: false, automationTraceRetentionDays: 90, expectedRevision: 1 },
        { actorId: 'actor', source: 'UI' },
        tx as unknown as Prisma.TransactionClient
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(tx.serviceAutomationConfig.updateMany).not.toHaveBeenCalled();
    expect(tx.systemSettings.upsert).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
  it('does not reactivate staged live services behind a global enable', async () => {
    vi.mocked(getAutomationSettings).mockResolvedValue({ ...previous, automationEnabled: false });
    const tx = transaction();
    tx.serviceAutomationConfig.count.mockResolvedValue(1);
    await expect(
      updateAutomationSettings(
        { automationEnabled: true, automationTraceRetentionDays: 90, expectedRevision: 2 },
        { actorId: 'actor', source: 'UI' },
        tx as unknown as Prisma.TransactionClient
      )
    ).rejects.toThrow('Services are already configured');
    expect(tx.systemSettings.upsert).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
