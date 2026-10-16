import { beforeEach, expect, it, vi } from 'vitest';
import * as actions from '@/app/(app)/services/[id]/runbook-actions';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
const mocks = vi.hoisted(() => ({ modify: vi.fn(), capability: vi.fn(), find: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertCanModifyService: mocks.modify,
  assertCanViewService: vi.fn(),
  assertCapability: mocks.capability,
}));
vi.mock('@/lib/prisma', () => ({ default: { serviceAutomationRule: { findFirst: mocks.find } } }));
const service = 'cmv7kbd0l000cxlzuo1cmhu1e';
const rule = 'cmv7kbd0l000dxlzuo1cmhu1e';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.modify.mockResolvedValue({ id: 'responder' });
  mocks.capability.mockImplementation(async (cap: string) => {
    if (cap === CAPABILITIES.RUNBOOK_MANAGE) throw new Error('Runbook management required');
    return { id: 'responder' };
  });
});
it.each([
  ['attach', () => actions.attachRunbookAction(service, new FormData())],
  ['edit', () => actions.updateRunbookBindingAction(service, rule, new FormData())],
  ['trigger edit', () => actions.configureRunbookTriggerAction(service, rule, new FormData())],
  ['detach', () => actions.detachRunbookAction(service, rule)],
  ['pause', () => actions.pauseRuleAction(service, rule)],
  ['duplicate', () => actions.duplicateRuleAction(service, rule)],
  ['activate', () => actions.activateRuleAction(service, rule, new FormData())],
  ['policy request', () => actions.checkRulePolicyAction(service, rule)],
] as const)(
  'denies %s to a service-authorized responder before any configuration lookup',
  async (_, action) => {
    expect(hasCapability('RESPONDER', CAPABILITIES.RUNBOOK_READ_ALL)).toBe(true);
    expect(hasCapability('RESPONDER', CAPABILITIES.RUNBOOK_MANAGE)).toBe(false);
    await expect(action()).rejects.toThrow('Runbook management required');
    expect(mocks.modify).toHaveBeenCalledWith(service);
    expect(mocks.capability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_MANAGE);
    expect(mocks.find).not.toHaveBeenCalled();
  }
);
it('retains the separate service modification boundary for administrators', async () => {
  mocks.capability.mockResolvedValue({ id: 'admin' });
  mocks.modify.mockRejectedValue(new Error('Service modification denied'));
  await expect(actions.pauseRuleAction(service, rule)).rejects.toThrow(
    'Service modification denied'
  );
  expect(mocks.find).not.toHaveBeenCalled();
});
