import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestUser,
} from '../helpers/test-db';
vi.mock('@/lib/rbac', () => ({ assertCanViewPolicy: vi.fn(async () => {}) }));
vi.mock('@/app/(app)/policies/actions', () => ({ setPolicyArchived: vi.fn() }));
import PolicyDependencies from '@/components/policies/PolicyDependencies';

beforeEach(resetDatabase, 30_000);
afterAll(() => db.$disconnect());

it('renders current references first and bounded historical pages from lightweight metadata', async () => {
  const actor = await createTestUser({ role: 'ADMIN' });
  const service = await createTestService('Dependency paging');
  const policy = await db.escalationPolicy.create({ data: { name: 'Paged policy' } });
  let currentId = '';
  for (let versionNumber = 1; versionNumber <= 26; versionNumber++) {
    const version = await db.automationVersion.create({
      data: {
        serviceId: service.id,
        versionNumber,
        publishedBy: actor.id,
        checksum: `paging-${versionNumber}`,
        // Deliberately unavailable historical definition: the UI must use persisted metadata.
        snapshot: { diagnostics: 'unused'.repeat(1000) },
        compiledSnapshot: {},
        lintReport: [],
        policyRefs: {
          create: {
            escalationPolicyId: policy.id,
            policyNameSnapshot: policy.name,
            ruleReferences: [
              {
                id: `rule-${versionNumber}`,
                name: versionNumber === 26 ? 'Current routing rule' : 'Historical metadata rule',
                enabled: true,
              },
            ],
          },
        },
      },
    });
    currentId = version.id;
  }
  await db.serviceAutomationConfig.create({
    data: { serviceId: service.id, activeVersionId: currentId },
  });
  const first = renderToStaticMarkup(
    await PolicyDependencies({
      policyId: policy.id,
      archived: false,
      canManage: false,
      mobile: true,
    })
  );
  expect(first).toContain('1 active versions');
  expect(first).toContain('25 historical versions');
  expect(first.indexOf('Current routing rule')).toBeLessThan(
    first.indexOf('Historical metadata rule')
  );
  expect(first.match(/Historical metadata rule/g)).toHaveLength(20);
  expect(first).toContain('depPage=2');
  expect(first).toContain(`/m/services/${service.id}/automation`);
  const second = renderToStaticMarkup(
    await PolicyDependencies({
      policyId: policy.id,
      archived: false,
      canManage: false,
      mobile: true,
      page: 2,
    })
  );
  expect(second.match(/Historical metadata rule/g)).toHaveLength(5);
  expect(second).toContain('Previous dependencies');
  expect(second).not.toContain('More dependencies');
});
