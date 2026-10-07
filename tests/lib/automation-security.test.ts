import { describe, expect, it, vi, beforeEach } from 'vitest';
import { compileAutomation } from '@/lib/automation/compiler';
import { discoverFields } from '@/lib/automation/discovery';
import { checksum } from '@/lib/automation/cache';
import { hasCapability } from '@/lib/authorization';
import { emptySnapshot } from '@/lib/automation/contract';
import { assertAutomationAccess } from '@/lib/automation/access';
import { assertCanViewService, assertCanModifyService, getUserPermissions } from '@/lib/rbac';
vi.mock('@/lib/rbac', () => ({
  assertCanViewService: vi.fn(),
  assertCanModifyService: vi.fn(),
  getUserPermissions: vi.fn(),
}));
describe('automation security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCanViewService).mockResolvedValue({ id: 'user', role: 'AUDITOR' } as never);
    vi.mocked(assertCanModifyService).mockResolvedValue({ id: 'user', role: 'RESPONDER' } as never);
  });
  it('only admins can publish or enable LIVE', () => {
    for (const role of ['RESPONDER', 'AUDITOR', 'USER'] as const)
      expect(hasCapability(role, 'automation.publish')).toBe(false);
    expect(hasCapability('ADMIN', 'automation.publish')).toBe(true);
  });
  it('checks scoped service modification before draft edits', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({ capabilities: ['automation.edit'] } as never);
    await assertAutomationAccess('owned-service', 'automation.edit');
    expect(assertCanModifyService).toHaveBeenCalledWith('owned-service');
    vi.mocked(assertCanModifyService).mockRejectedValue(new Error('Service ownership required'));
    await expect(assertAutomationAccess('other-service', 'automation.edit')).rejects.toThrow(
      'ownership'
    );
  });
  it('read permissions never become publish permissions', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({ capabilities: ['automation.read'] } as never);
    await expect(assertAutomationAccess('service', 'automation.publish')).rejects.toThrow('denied');
  });
  it('canonical checksums survive JSONB property ordering', () =>
    expect(checksum({ b: 2, a: { d: 4, c: 3 } })).toBe(checksum({ a: { c: 3, d: 4 }, b: 2 })));
  it('redacts sensitive paths and bounds discovery', () => {
    const result = discoverFields({
      Authorization: 'Bearer private',
      cookie: 'cookie',
      secret: 'secret',
      oauth: { token: 'token' },
      AWSAccountId: '1234',
      alerts: [{ labels: { environment: 'production' } }],
      large: 'a'.repeat(257),
    });
    expect(result.map(r => r.path)).toEqual(['AWSAccountId', 'alerts[0].labels.environment']);
    expect(
      discoverFields(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`field${i}`, i])))
        .length
    ).toBeLessThanOrEqual(64);
  });
  it('rejects arbitrary language extensions and invalid priorities', () => {
    expect(() => compileAutomation({ ...emptySnapshot, script: 'fetch(secret)' })).toThrow();
    expect(() =>
      compileAutomation({
        ...emptySnapshot,
        rules: [
          {
            id: 'p0',
            name: 'P0',
            phase: 'ENRICH',
            conditions: [],
            actions: [{ type: 'SET_PRIORITY', value: 'P0' }],
          },
        ],
      })
    ).toThrow();
  });
});
