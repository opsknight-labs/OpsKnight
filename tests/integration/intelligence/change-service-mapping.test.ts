import { beforeEach, describe, expect, it } from 'vitest';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  listUnmappedChanges,
  recordIntegrationChange,
  setChangeServiceMapping,
} from '@/lib/intelligence/changes/service-mapping';
import { mapKubernetesRolloutChange } from '@/lib/intelligence/changes/deploy-mappers';
import { applyCatalogImport, parseCatalog } from '@/lib/intelligence/dependencies/import';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const now = new Date();
let seq = 0;
function deploy(component: string, labels: Record<string, string> = {}) {
  seq += 1;
  return {
    source: 'kubernetes',
    kind: 'DEPLOY' as const,
    summary: `Rollout ${component}`,
    component,
    labels,
    dedupKey: `${component}:${seq}`,
    occurredAt: new Date(now.getTime() - 60_000),
  };
}

async function setup() {
  const owner = await createTestService('platform');
  const integration = await db.integration.create({
    data: {
      name: 'cluster events',
      key: `k-${Math.random()}`,
      type: 'WEBHOOK',
      serviceId: owner.id,
    },
  });
  return { owner, integration };
}

describe('change service mapping', () => {
  it('keeps an integration without a mapping on its own service', async () => {
    const { owner, integration } = await setup();
    const other = await createTestService('cart');
    const { id } = await recordIntegrationChange(integration, deploy(other.name));
    expect(await db.changeEvent.findUnique({ where: { id } })).toMatchObject({
      serviceId: owner.id,
      unmappedIntegrationId: null,
    });
  });

  it('resolves by mapping, Backstage entity name and exact service name, else stores it unmapped', async () => {
    const { integration } = await setup();
    const admin = await createTestUser({ role: 'ADMIN' });
    const [cart, payments, search] = await Promise.all([
      createTestService('cart'),
      createTestService('payments'),
      createTestService('search'),
    ]);
    await db.intelligenceSettings.create({
      data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, revision: 1, enabled: true },
    });
    await setChangeServiceMapping({
      integrationId: integration.id,
      value: 'Cart-API',
      serviceId: cart.id,
      actorId: admin.id,
    });
    await applyCatalogImport(
      db,
      parseCatalog(
        `apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: payments-gateway\n  annotations:\n    opsknight.com/service-id: ${payments.id}\nspec: {}\n`
      ),
      null,
      'upload'
    );

    const record = async (change: Parameters<typeof recordIntegrationChange>[1]) =>
      db.changeEvent.findUniqueOrThrow({
        where: { id: (await recordIntegrationChange(integration, change)).id },
      });
    // The forwarded rollout carries the app label the mapping names.
    const rollout = mapKubernetesRolloutChange({
      reason: 'RolloutCompleted',
      lastTimestamp: new Date(now.getTime() - 30_000).toISOString(),
      involvedObject: {
        kind: 'Rollout',
        name: 'cart',
        namespace: 'shop',
        labels: { 'app.kubernetes.io/name': 'cart-api' },
      },
    })!;
    expect((await record({ ...deploy('x'), ...rollout, kind: 'DEPLOY' } as never)).serviceId).toBe(
      cart.id
    );
    expect((await record(deploy('payments-gateway'))).serviceId).toBe(payments.id);
    expect((await record(deploy('worker', { app: search.name.toUpperCase() }))).serviceId).toBe(
      search.id
    );
    const unmapped = await record(deploy('inventory'));
    expect(unmapped).toMatchObject({ serviceId: null, unmappedIntegrationId: integration.id });
    // An unmapped change is not global: no risk or re-analysis work until it is mapped.
    expect(await db.intelligenceWorkItem.count({ where: { subjectKey: unmapped.id } })).toBe(0);

    expect(await listUnmappedChanges()).toEqual([
      expect.objectContaining({
        integrationId: integration.id,
        integrationName: 'cluster events',
        component: 'inventory',
        count: 1,
      }),
    ]);

    const inventory = await createTestService('inventory');
    const result = await setChangeServiceMapping({
      integrationId: integration.id,
      value: 'inventory',
      serviceId: inventory.id,
      actorId: admin.id,
    });
    expect(result).toEqual({ version: 2, remapped: 1 });
    expect(await db.changeEvent.findUnique({ where: { id: unmapped.id } })).toMatchObject({
      serviceId: inventory.id,
      unmappedIntegrationId: null,
    });
    expect(await db.intelligenceWorkItem.count({ where: { subjectKey: unmapped.id } })).toBe(1);
    expect(await listUnmappedChanges()).toEqual([]);
    expect((await record(deploy('inventory'))).serviceId).toBe(inventory.id);
    expect(
      await db.auditLog.count({ where: { action: 'intelligence.change_mapping.updated' } })
    ).toBe(2);

    // A deleted mapped service falls through instead of failing the webhook.
    await db.service.delete({ where: { id: inventory.id } });
    expect((await record(deploy('inventory'))).unmappedIntegrationId).toBe(integration.id);
  });
});
