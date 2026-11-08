import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { breakers, invalidateGatewayCache, registerAiGateway } from '@/lib/intelligence/ai/gateway';
import { resolveLanguageModel } from '@/lib/intelligence/ai/port';
import { updateAiRouting } from '@/lib/intelligence/ai/routing-settings';
import { getAiSettings, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

let primary: FakeServer;
let strong: FakeServer;
beforeAll(async () => {
  [primary, strong] = await Promise.all([startFakeModel(), startFakeModel()]);
  registerAiGateway();
});
afterAll(async () => {
  await Promise.all([primary.close(), strong.close()]);
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  for (const server of [primary, strong]) {
    server.requests.length = 0;
    server.script.length = 0;
  }
  invalidateGatewayCache();
});

async function setup(options: { strongClass?: 'INTERNAL' | 'PERSONAL' } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const audit = { actorId: admin.id, source: 'UI' as const };
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 100,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 256,
      requestTimeoutMs: 10_000,
      expectedRevision: 0,
    },
    audit
  );
  const provider = (
    name: string,
    server: FakeServer,
    priority: number,
    maxDataClass = 'PERSONAL'
  ) =>
    saveAiProvider(
      null,
      {
        name,
        kind: 'OPENAI_COMPATIBLE',
        model: `${name.toLowerCase()}-default`,
        baseUrl: server.url,
        apiKey: 'k',
        enabled: true,
        isExternal: false,
        maxDataClass,
        allowPrivateNetwork: true,
        priority,
      },
      audit
    );
  const a = await provider('Primary', primary, 1);
  const b = await provider('Strong', strong, 2, options.strongClass ?? 'PERSONAL');
  breakers.recordSuccess(a.id);
  breakers.recordSuccess(b.id);
  invalidateGatewayCache();
  return { admin, audit, a, b };
}

async function ask(capability: 'DIAGNOSE' | 'SQUIRE_CHAT' | 'CLASSIFY', actorId: string) {
  const port = await resolveLanguageModel(capability, 'PERSONAL');
  if (!port) throw new Error('no port');
  return port.generate({
    context: { actorId, capability, dataClass: 'PERSONAL' },
    messages: [{ role: 'user', content: 'hello', dataClass: 'PERSONAL' }],
  });
}

describe('per-capability model routing through the gateway', () => {
  it('uses the priority chain for every capability until a route is saved', async () => {
    const { admin } = await setup();
    const result = await ask('DIAGNOSE', admin.id);
    expect(result.served.model).toBe('primary-default');
    expect(primary.requests).toHaveLength(1);
    expect(strong.requests).toHaveLength(0);
  });

  it('sends a routed capability to its provider and model, and leaves others alone', async () => {
    const { admin, audit, b } = await setup();
    const saved = await updateAiRouting(
      {
        squireInvestigationEnabled: true,
        capabilityRouting: { DIAGNOSE: { providerId: b.id, model: 'reasoning-xl' } },
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    expect(saved.squireInvestigationEnabled).toBe(true);
    expect(saved.capabilityRouting).toEqual({
      DIAGNOSE: { providerId: b.id, model: 'reasoning-xl' },
    });
    invalidateGatewayCache();

    const diagnosed = await ask('DIAGNOSE', admin.id);
    expect(diagnosed.served).toMatchObject({
      providerId: b.id,
      model: 'reasoning-xl',
      fallbackDepth: 0,
    });
    expect(strong.requests[0].body.model).toBe('reasoning-xl');

    const chat = await ask('SQUIRE_CHAT', admin.id);
    expect(chat.served.model).toBe('primary-default');
    expect(primary.requests.at(-1)!.body.model).toBe('primary-default');

    const audits = await db.auditLog.findMany({
      where: { action: 'intelligence.ai.routing.updated' },
    });
    expect(audits).toHaveLength(1);
  });

  it('falls back to the rest of the chain when the routed provider fails', async () => {
    const { admin, audit, b } = await setup();
    await updateAiRouting(
      {
        squireInvestigationEnabled: false,
        capabilityRouting: { CLASSIFY: { providerId: b.id, model: 'tiny' } },
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    invalidateGatewayCache();
    strong.script.push({ status: 500 }, { status: 500 });
    const result = await ask('CLASSIFY', admin.id);
    expect(strong.requests.length).toBeGreaterThan(0);
    expect(result.served).toMatchObject({ model: 'primary-default', fallbackDepth: 1 });
  });

  it('never routes data to a provider that is not cleared for it', async () => {
    const { admin, audit, b } = await setup({ strongClass: 'INTERNAL' });
    await updateAiRouting(
      {
        squireInvestigationEnabled: false,
        capabilityRouting: { DIAGNOSE: { providerId: b.id } },
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    invalidateGatewayCache();
    const result = await ask('DIAGNOSE', admin.id);
    expect(result.served.model).toBe('primary-default');
    expect(strong.requests).toHaveLength(0);
  });

  it('rejects unknown providers and stale revisions', async () => {
    const { audit } = await setup();
    const revision = (await getAiSettings()).revision;
    await expect(
      updateAiRouting(
        {
          squireInvestigationEnabled: false,
          capabilityRouting: { DIAGNOSE: { providerId: 'missing' } },
          expectedRevision: revision,
        },
        audit
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      updateAiRouting(
        { squireInvestigationEnabled: true, capabilityRouting: {}, expectedRevision: revision - 1 },
        audit
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    // Clearing every route stores null, which reads back as no routing.
    await updateAiRouting(
      { squireInvestigationEnabled: false, capabilityRouting: {}, expectedRevision: revision },
      audit
    );
    const row = await db.aiSettings.findUniqueOrThrow({ where: { id: 'default' } });
    expect(row.capabilityRouting).toBeNull();
    expect((await getAiSettings()).capabilityRouting).toEqual({});
  });

  it('keeps routing when the general settings form is saved', async () => {
    const { audit, b } = await setup();
    await updateAiRouting(
      {
        squireInvestigationEnabled: true,
        capabilityRouting: { SUMMARIZE: { providerId: b.id } },
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    await updateAiSettings(
      {
        enabled: true,
        squireEnabled: true,
        squireName: 'Pip',
        allowExternalFallback: false,
        requestsPerMinutePerUser: 100,
        dailyTokenBudget: 500_000,
        maxOutputTokens: 256,
        requestTimeoutMs: 10_000,
        expectedRevision: (await getAiSettings()).revision,
      },
      audit
    );
    const after = await getAiSettings();
    expect(after.squireInvestigationEnabled).toBe(true);
    expect(after.capabilityRouting).toEqual({ SUMMARIZE: { providerId: b.id } });
  });
});
