import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiGatewayError, breakers, guardedFetchFor, invalidateGatewayCache, resolveGatewayPort } from '@/lib/intelligence/ai/gateway';
import { getTodayUsage, recordAiUsage } from '@/lib/intelligence/ai/budget';
import { getAiSettings, listAiProviders, saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import type { AiGenerateRequest, AiStreamEvent } from '@/lib/intelligence/ai/port';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import { trace } from '@opentelemetry/api';
import { installFakeTracer } from '../../helpers/fake-tracer';
import { createTestUser, resetDatabase, testPrisma as db } from '../../helpers/test-db';

let primary: FakeServer;
let secondary: FakeServer;

beforeAll(async () => {
  primary = await startFakeModel();
  secondary = await startFakeModel();
});
afterAll(async () => {
  await primary.close();
  await secondary.close();
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  primary.requests.length = 0;
  secondary.requests.length = 0;
  primary.script.length = 0;
  secondary.script.length = 0;
  invalidateGatewayCache();
  for (const id of ['p', 's']) breakers.recordSuccess(id);
});

async function configure(options: { allowExternalFallback?: boolean; budget?: number; rate?: number } = {}) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const actor = { actorId: admin.id, source: 'UI' as const };
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Squire',
      allowExternalFallback: options.allowExternalFallback ?? false,
      requestsPerMinutePerUser: options.rate ?? 50,
      dailyTokenBudget: options.budget ?? 500_000,
      maxOutputTokens: 512,
      requestTimeoutMs: 10_000,
      expectedRevision: 0,
    },
    actor
  );
  invalidateGatewayCache();
  return { admin, actor };
}

const provider = (name: string, url: string, overrides: Record<string, unknown> = {}) => ({
  name,
  kind: 'OPENAI_COMPATIBLE' as const,
  model: 'test-model',
  baseUrl: url,
  apiKey: 'sk-test-secret-key-value-1234567890',
  enabled: true,
  isExternal: false,
  maxDataClass: 'INTERNAL' as const,
  allowPrivateNetwork: true,
  priority: 10,
  ...overrides,
});

const request = (actorId: string, extra: Partial<AiGenerateRequest> = {}): AiGenerateRequest => ({
  context: { actorId, capability: 'SQUIRE_CHAT', dataClass: 'INTERNAL' },
  messages: [{ role: 'user', content: 'hello' }],
  ...extra,
});

describe('settings and providers', () => {
  it('stores keys encrypted, never returns them, and keeps secrets out of the audit log', async () => {
    const { actor } = await configure();
    const view = await saveAiProvider(null, provider('Local', primary.url), actor);
    expect(view).toMatchObject({ name: 'Local', hasApiKey: true, kind: 'OPENAI_COMPATIBLE' });
    expect(JSON.stringify(view)).not.toContain('sk-test');
    const row = await db.aiProvider.findFirstOrThrow();
    expect(row.apiKeyEncrypted).toBeTruthy();
    expect(row.apiKeyEncrypted).not.toContain('sk-test');
    const audit = JSON.stringify(await db.auditLog.findMany());
    expect(audit).not.toContain('sk-test');
    expect(audit).toContain('intelligence.ai.provider.created');

    // Updating without a key keeps the stored one.
    await saveAiProvider(row.id, { ...provider('Local', primary.url), apiKey: '' }, actor);
    expect((await db.aiProvider.findUniqueOrThrow({ where: { id: row.id } })).apiKeyEncrypted).toBe(row.apiKeyEncrypted);
    expect((await listAiProviders())[0].hasApiKey).toBe(true);
  });

  it('rejects unsafe or inconsistent endpoints at save time', async () => {
    const { actor } = await configure();
    const bad = (overrides: Record<string, unknown>) => saveAiProvider(null, provider('X', primary.url, overrides), actor);
    await expect(bad({ allowPrivateNetwork: false })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // loopback needs consent
    await expect(bad({ allowPrivateNetwork: false, baseUrl: 'http://api.example.com/v1' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(bad({ baseUrl: 'https://user:pass@example.com/v1' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(bad({ baseUrl: 'ftp://example.com' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(bad({ baseUrl: 'not a url' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(bad({ isExternal: true })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // private network is not external
    await expect(bad({ baseUrl: null })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' }); // compatible needs a URL
    expect(await db.aiProvider.count()).toBe(0);
    await saveAiProvider(null, provider('Dup', primary.url), actor);
    await expect(saveAiProvider(null, provider('Dup', secondary.url), actor)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('is off by default and uses a revision lock', async () => {
    expect(await getAiSettings()).toMatchObject({ enabled: false, squireEnabled: false, squireName: 'Squire', revision: 0 });
    const { actor } = await configure();
    await expect(
      updateAiSettings(
        { enabled: false, squireEnabled: false, squireName: 'Pip', allowExternalFallback: false, requestsPerMinutePerUser: 5, dailyTokenBudget: 5000, maxOutputTokens: 256, requestTimeoutMs: 5000, expectedRevision: 0 },
        actor
      )
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    await expect(
      updateAiSettings(
        { enabled: true, squireEnabled: true, squireName: '<script>', allowExternalFallback: false, requestsPerMinutePerUser: 5, dailyTokenBudget: 5000, maxOutputTokens: 256, requestTimeoutMs: 5000, expectedRevision: 1 },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('gateway', () => {
  it('returns nothing while AI is off, unconfigured, or no provider may receive the data class', async () => {
    expect(await resolveGatewayPort('INTERNAL')).toBeNull();
    const { actor } = await configure();
    expect(await resolveGatewayPort('INTERNAL')).toBeNull(); // enabled but no providers
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    expect(await resolveGatewayPort('INTERNAL')).not.toBeNull();
    expect(await resolveGatewayPort('SENSITIVE')).toBeNull(); // ceiling is INTERNAL
  });

  it('generates through the real SDK, sends the decrypted key, redacts secrets and records usage', async () => {
    const { admin, actor } = await configure();
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    primary.script.push({ content: 'Looks like a bad deploy.', usage: [20, 9] });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    const result = await port.generate(
      request(admin.id, { messages: [{ role: 'user', content: 'why? password=hunter2hunter2 and Bearer abcdefghijklmnopqrstuvwxyz0123456789' }] })
    );
    expect(result.text).toBe('Looks like a bad deploy.');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 9 });
    expect(result.served).toMatchObject({ model: 'test-model', fallbackDepth: 0 });

    expect(primary.requests).toHaveLength(1);
    expect(primary.requests[0].auth).toBe('Bearer sk-test-secret-key-value-1234567890');
    const sent = JSON.stringify(primary.requests[0].body);
    expect(sent).not.toContain('hunter2');
    expect(sent).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(sent).toContain('[redacted]');
    expect(await getTodayUsage()).toEqual({ requests: 1, inputTokens: 20, outputTokens: 9 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'intelligence.ai.interaction' } });
    expect(JSON.stringify(audit)).not.toContain('bad deploy');
  });

  it('traces calls with bounded attributes and never puts prompts or answers in a span', async () => {
    const { admin, actor } = await configure();
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    trace.disable();
    const spans = installFakeTracer();
    try {
      primary.script.push({ content: 'The secret answer is 42.', usage: [10, 4] }, { content: 'streamed secret answer', usage: [6, 3] });
      const port = (await resolveGatewayPort('INTERNAL'))!;
      await port.generate(request(admin.id, { messages: [{ role: 'user', content: 'private prompt text' }] }));
      for await (const event of port.stream(request(admin.id, { messages: [{ role: 'user', content: 'private prompt text' }] }))) void event;
      const named = spans.filter(span => span.name.startsWith('intelligence.ai.'));
      expect(named.map(span => span.name)).toEqual(['intelligence.ai.generate', 'intelligence.ai.stream']);
      expect(named.every(span => span.ended)).toBe(true);
      expect(named[0].attributes).toMatchObject({ 'ai.capability': 'SQUIRE_CHAT', 'ai.provider.kind': 'OPENAI_COMPATIBLE', 'ai.tokens.input': 10, 'ai.tokens.output': 4 });
      expect(named[1].attributes).toMatchObject({ 'ai.tokens.input': 6, 'ai.tokens.output': 3 });
      expect(JSON.stringify(spans)).not.toMatch(/secret|private prompt|sk-test/);
    } finally {
      trace.disable();
    }
  });

  it('falls back to the next eligible provider and opens the breaker on a failing one', async () => {
    const { admin, actor } = await configure();
    const first = await saveAiProvider(null, provider('Primary', primary.url, { priority: 1 }), actor);
    await saveAiProvider(null, provider('Secondary', secondary.url, { priority: 2 }), actor);
    invalidateGatewayCache();
    for (let i = 0; i < 8; i += 1) primary.script.push({ status: 500 });
    secondary.script.push({ content: 'from secondary' }, { content: 'again' }, { content: 'again' }, { content: 'again' });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    const result = await port.generate(request(admin.id));
    expect(result).toMatchObject({ text: 'from secondary', served: { fallbackDepth: 1 } });
    for (let i = 0; i < 3; i += 1) await port.generate(request(admin.id));
    // After repeated failures the primary is skipped instead of being retried on every request.
    expect(breakers.isOpen(first.id)).toBe(true);
    const hits = primary.requests.length;
    await port.generate(request(admin.id));
    expect(primary.requests.length).toBe(hits);
  }, 60_000);

  it('never falls back from a self-hosted provider to an external one unless explicitly allowed', async () => {
    const { admin, actor } = await configure({ allowExternalFallback: false });
    await saveAiProvider(null, provider('Internal', primary.url, { priority: 1 }), actor);
    // Inserted directly: saving an external endpoint would resolve public DNS.
    await db.aiProvider.create({
      data: { name: 'External2', kind: 'OPENAI_COMPATIBLE', model: 'x', baseUrl: secondary.url, enabled: true, isExternal: true, maxDataClass: 'INTERNAL', allowPrivateNetwork: false, priority: 2 },
    });
    invalidateGatewayCache();
    for (let i = 0; i < 4; i += 1) primary.script.push({ status: 500 });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    await expect(port.generate(request(admin.id))).rejects.toMatchObject({ code: 'ALL_PROVIDERS_FAILED' });
    expect(secondary.requests).toHaveLength(0);
  }, 60_000);

  it('blocks private addresses for providers without private-network consent (SSRF)', async () => {
    const { admin } = await configure();
    await db.aiProvider.create({
      data: { name: 'Sneaky', kind: 'OPENAI_COMPATIBLE', model: 'x', baseUrl: primary.url, enabled: true, isExternal: true, maxDataClass: 'INTERNAL', allowPrivateNetwork: false, priority: 1 },
    });
    invalidateGatewayCache();
    const port = (await resolveGatewayPort('INTERNAL'))!;
    await expect(port.generate(request(admin.id))).rejects.toMatchObject({ code: 'ALL_PROVIDERS_FAILED' });
    expect(primary.requests).toHaveLength(0);
  });

  it('pins private-network providers to the approved origin', async () => {
    const guarded = guardedFetchFor({ allowPrivateNetwork: true, baseUrl: primary.url });
    await expect(guarded(secondary.url + '/chat/completions', { method: 'POST' })).rejects.toThrow(/approved provider origin/);
    await expect(guarded('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/approved provider origin/);
  });

  it('enforces the per-user rate limit and the daily token budget before calling the model', async () => {
    const { admin, actor } = await configure({ rate: 2, budget: 1_000 });
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    const port = (await resolveGatewayPort('INTERNAL'))!;
    await port.generate(request(admin.id));
    await port.generate(request(admin.id));
    await expect(port.generate(request(admin.id))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const other = await createTestUser({ role: 'ADMIN' });
    await recordAiUsage({ inputTokens: 900, outputTokens: 200 });
    const calls = primary.requests.length;
    await expect(port.generate(request(other.id))).rejects.toBeInstanceOf(AiGatewayError);
    await expect(port.generate(request(other.id))).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect(primary.requests.length).toBe(calls);
  });

  it('streams text deltas and finishes with usage', async () => {
    const { admin, actor } = await configure();
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    primary.script.push({ content: 'Roll back the deploy now', usage: [30, 5] });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    const events: AiStreamEvent[] = [];
    for await (const event of port.stream(request(admin.id))) events.push(event);
    const text = events.filter(e => e.type === 'text-delta').map(e => (e as { delta: string }).delta).join('');
    expect(text).toBe('Roll back the deploy now');
    const finish = events.at(-1);
    expect(finish).toMatchObject({ type: 'finish', result: { usage: { inputTokens: 30, outputTokens: 5 } } });
    expect(await getTodayUsage()).toMatchObject({ requests: 1, inputTokens: 30 });
  });

  it('reports a clean stream error when every provider fails, without splicing partial answers', async () => {
    const { admin, actor } = await configure();
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    primary.script.push({ status: 500 }, { status: 500 });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    const events: AiStreamEvent[] = [];
    for await (const event of port.stream(request(admin.id))) events.push(event);
    expect(events).toEqual([{ type: 'error', message: 'AI is temporarily unavailable', retryable: true }]);
  });

  it('runs read tools under the caller, treats results as data, and returns write proposals without running them', async () => {
    const { admin, actor } = await configure();
    await saveAiProvider(null, provider('Local', primary.url), actor);
    invalidateGatewayCache();
    const executed: unknown[] = [];
    primary.script.push({ toolCall: { name: 'lookup', args: '{"q":"db"}' } }, { content: 'Found it.' });
    const port = (await resolveGatewayPort('INTERNAL'))!;
    const result = await port.generate(
      request(admin.id, {
        tools: [
          {
            name: 'lookup',
            description: 'look something up',
            kind: 'READ',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
            execute: async input => {
              executed.push(input);
              return { hit: 'token=abcdef123456 value' };
            },
          },
        ],
      })
    );
    expect(result.text).toBe('Found it.');
    expect(executed).toEqual([{ q: 'db' }]);
    // The second model call carries the tool result, with secrets redacted.
    const second = JSON.stringify(primary.requests[1].body);
    expect(second).toContain('hit');
    expect(second).not.toContain('abcdef123456');

    primary.script.push({ toolCall: { name: 'resolve_incident', args: '{"id":"x"}' } }, { content: 'unused' });
    const proposal = await port.generate(
      request(admin.id, {
        maxSteps: 1,
        tools: [{ name: 'resolve_incident', description: 'resolve', kind: 'PROPOSE_WRITE', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }],
      })
    );
    expect(proposal.toolCalls).toEqual([{ name: 'resolve_incident', input: { id: 'x' } }]);
  });
});
