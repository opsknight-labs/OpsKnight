import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { assertCanViewService, assertCapability } from '@/lib/rbac';
import { previewRunbookExecution, startRunbookExecution } from '@/lib/runbooks/orchestrator';
import {
  previewServiceRuleAction,
  executeServiceRuleAction,
} from '@/app/(app)/services/[id]/runbook-actions';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { serviceAutomationRule: { findFirst: vi.fn() } } }));
vi.mock('@/lib/rbac', () => ({
  assertCanViewService: vi.fn(),
  assertCanModifyService: vi.fn(),
  assertCapability: vi.fn(),
}));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: vi.fn(),
  startRunbookExecution: vi.fn(),
}));
const serviceId = 'cmv7kbd0l000cxlzuo1cmhu1e';
const ruleId = 'cmv7kbd0l000dxlzuo1cmhu1e';
const versionId = 'cmv7kbd0l000exlzuo1cmhu1e';
describe('service rule execution authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCapability).mockResolvedValue({ id: 'actor' } as Awaited<
      ReturnType<typeof assertCapability>
    >);
    vi.mocked(prisma.serviceAutomationRule.findFirst).mockResolvedValue({
      id: ruleId,
      serviceId,
      runbookId: 'workflow',
      versionStrategy: 'PINNED',
      runbookVersion: {
        id: versionId,
        inputs: [],
        definition: {
          steps: [
            {
              key: 'diagnose',
              name: 'Diagnostic',
              type: 'LINUX_DIAGNOSTICS',
              riskClass: 'READ_ONLY',
              config: {},
            },
          ],
        },
      },
      runbook: {},
    } as never);
  });
  it('checks service authorization and scopes the rule before preparing a preview', async () => {
    await previewServiceRuleAction(serviceId, ruleId, true);
    expect(assertCanViewService).toHaveBeenCalledWith(serviceId);
    expect(prisma.serviceAutomationRule.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ruleId, serviceId, enabled: true } })
    );
    expect(previewRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: ruleId,
        serviceId,
        triggeredByUserId: 'actor',
        runbookVersionId: versionId,
      })
    );
  });
  it('rejects a write mislabeled read-only before planning a read-only test', async () => {
    vi.mocked(prisma.serviceAutomationRule.findFirst).mockResolvedValue({
      id: ruleId,
      serviceId,
      versionStrategy: 'PINNED',
      runbookVersion: {
        id: versionId,
        inputs: [],
        definition: {
          steps: [
            {
              key: 'restart',
              name: 'Restart',
              type: 'SYSTEMD',
              riskClass: 'READ_ONLY',
              config: { action: 'restart', unit: 'fixture.service' },
            },
          ],
        },
      },
      runbook: {},
    } as never);
    const result = await previewServiceRuleAction(serviceId, ruleId, true);
    expect(result.error).toBeTruthy();
    expect(previewRunbookExecution).not.toHaveBeenCalled();
    expect(startRunbookExecution).not.toHaveBeenCalled();
  });
  it('requires a valid single-use preview token when executing', async () => {
    const data = new FormData();
    data.set('previewDigest', 'a'.repeat(64));
    const result = await executeServiceRuleAction(serviceId, ruleId, false, data);
    expect(result?.error).toBeTruthy();
    expect(startRunbookExecution).not.toHaveBeenCalled();
    data.set('previewAuthorizationToken', 'b'.repeat(64));
    await executeServiceRuleAction(serviceId, ruleId, false, data);
    expect(startRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: ruleId,
        expectedPlanDigest: 'a'.repeat(64),
        previewAuthorizationToken: 'b'.repeat(64),
      })
    );
  });
});
