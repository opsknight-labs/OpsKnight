import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  DEFAULT_POLICY_DEFINITION,
  INTELLIGENCE_SETTINGS_DEFAULTS,
} from '@/lib/intelligence/contract';
import { breakers, invalidateGatewayCache } from '@/lib/intelligence/ai/gateway';
import { saveAiProvider, updateAiSettings } from '@/lib/intelligence/ai/settings';
import {
  deleteObservabilityConnection,
  listEligibleConnections,
  listObservabilityConnections,
  saveObservabilityConnection,
  testObservabilityConnection,
} from '@/lib/intelligence/connectors/service';
import { readSourceStates } from '@/lib/intelligence/squire/evidence-access';
import { streamSquire } from '@/lib/intelligence/squire/chat';
import { buildSquireTools } from '@/lib/intelligence/squire/tools';
import type { KubernetesSummary } from '@/lib/intelligence/connectors/adapters/types';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';
import { publishPolicyVersion } from '@/lib/intelligence/settings/service';
import { startFakeModel, type FakeServer } from '../../helpers/fake-model-server';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/** A local stand-in for Prometheus, Loki and GitHub that records what it was asked. */
interface Backend {
  url: string;
  requests: Array<{ path: string; auth: string | undefined; method: string }>;
  status: number;
  close: () => Promise<void>;
}

async function startBackend(): Promise<Backend> {
  const state: Backend = { url: '', requests: [], status: 200, close: async () => undefined };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    state.requests.push({
      path: url.pathname,
      auth: req.headers.authorization,
      method: req.method ?? '',
    });
    if (state.status !== 200) {
      res.writeHead(state.status, { 'content-type': 'application/json' });
      res.end('{"error":"denied"}');
      return;
    }
    let body: unknown = { status: 'success', data: {} };
    if (url.pathname === '/api/v1/query_range')
      body = {
        status: 'success',
        data: {
          resultType: 'matrix',
          result: [
            {
              metric: { __name__: 'checkout_errors', job: 'checkout' },
              values: [
                [Math.floor(Date.now() / 1000) - 120, '2'],
                [Math.floor(Date.now() / 1000) - 60, '977'],
              ],
            },
          ],
        },
      };
    if (url.pathname === '/loki/api/v1/query_range')
      body = {
        data: {
          result: [
            {
              stream: { app: 'checkout' },
              values: [
                [
                  `${Date.now() - 60_000}000000`,
                  'payment failed for jane.doe@example.com token=sk-abcdefghijklmnopqrstuvwxyz123456',
                ],
              ],
            },
          ],
        },
      };
    if (url.pathname === '/api/v1/label/__name__/values')
      body = {
        status: 'success',
        // A backend that ignores match[] still gets filtered by prefix and capped.
        data: [
          'up',
          ...Array.from(
            { length: 60 },
            (_, index) => `http_requests_${String(index).padStart(2, '0')}`
          ),
        ],
      };
    if (url.pathname === '/api/v1/label/job/values')
      body = { status: 'success', data: ['checkout', 'api', 'checkout'] };
    if (url.pathname === '/apis/apps/v1/namespaces/shop/deployments')
      body = {
        items: [
          {
            metadata: { name: 'web', generation: 2 },
            spec: { replicas: 2 },
            status: {
              observedGeneration: 2,
              replicas: 2,
              readyReplicas: 2,
              updatedReplicas: 2,
              availableReplicas: 2,
            },
          },
          {
            metadata: { name: 'checkout', generation: 5 },
            spec: { replicas: 3 },
            status: {
              observedGeneration: 5,
              readyReplicas: 1,
              updatedReplicas: 1,
              availableReplicas: 1,
              conditions: [
                {
                  type: 'Progressing',
                  reason: 'ProgressDeadlineExceeded',
                  message: 'ReplicaSet "checkout-7d" has timed out progressing.',
                },
              ],
            },
          },
        ],
      };
    if (url.pathname === '/api/v1/namespaces/shop/pods')
      body = {
        items: [
          {
            metadata: { name: 'checkout-7d-a' },
            spec: { containers: [{ env: [{ name: 'DB_PASSWORD', value: 'hunter2-never-read' }] }] },
            status: {
              phase: 'Running',
              containerStatuses: [
                {
                  ready: false,
                  restartCount: 7,
                  state: { waiting: { reason: 'CrashLoopBackOff' } },
                  lastState: { terminated: { reason: 'OOMKilled' } },
                },
              ],
            },
          },
          {
            metadata: { name: 'web-1' },
            status: { phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] },
          },
        ],
      };
    if (url.pathname === '/api/v1/namespaces/shop/events')
      body = {
        items: Array.from({ length: 20 }, (_, index) => ({
          type: 'Warning',
          reason: 'BackOff',
          message: `Back-off restarting failed container ${index}`,
          involvedObject: { kind: 'Pod', name: 'checkout-7d-a' },
          lastTimestamp: new Date(Date.UTC(2026, 10, 20, 0, index)).toISOString(),
          count: index + 1,
        })),
      };
    if (url.pathname === '/api/v1/namespaces') body = { items: [{ metadata: { name: 'shop' } }] };
    if (url.pathname.startsWith('/repos/acme/checkout/commits/'))
      body = {
        sha: 'abcdef1234567',
        commit: { message: 'Lower connection pool' },
        files: [
          {
            filename: 'db.yml',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '-pool: 50\n+pool: 5',
          },
        ],
      };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise(resolve => server.close(() => resolve()));
  return state;
}

let model: FakeServer;
let backend: Backend;
beforeAll(async () => {
  model = await startFakeModel();
  backend = await startBackend();
});
afterAll(async () => {
  await model.close();
  await backend.close();
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  model.requests.length = 0;
  model.script.length = 0;
  backend.requests.length = 0;
  backend.status = 200;
  invalidateGatewayCache();
  breakers.recordSuccess('x');
});

const ui = (actorId: string) => ({ actorId, source: 'UI' as const });
const actorOf = async (userId: string) => {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
};

const SECRET = 'prom-token-ABCDEFGHIJKLMNOP';

async function addConnection(
  adminId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const view = await saveObservabilityConnection(
    null,
    {
      name: 'Prometheus',
      kind: 'PROMETHEUS',
      baseUrl: backend.url,
      secret: SECRET,
      allowPrivateNetwork: true,
      enabled: true,
      ...overrides,
    },
    ui(adminId)
  );
  return view.id;
}

describe('connection service', () => {
  it('encrypts the credential at rest, never returns it and audits every change without it', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const id = await addConnection(admin.id);

    const row = await db.observabilityConnection.findUniqueOrThrow({ where: { id } });
    expect(row.credentialEncrypted).toBeTruthy();
    expect(row.credentialEncrypted).not.toContain(SECRET);
    expect(row.createdById).toBe(admin.id);

    const [view] = await listObservabilityConnections();
    expect(view).toMatchObject({ id, hasCredential: true, enabled: true, kind: 'PROMETHEUS' });
    expect(JSON.stringify(view)).not.toContain(SECRET);

    // Updating without a secret keeps the stored one.
    await saveObservabilityConnection(
      id,
      {
        name: 'Prometheus main',
        kind: 'PROMETHEUS',
        baseUrl: backend.url,
        allowPrivateNetwork: true,
        enabled: false,
      },
      ui(admin.id)
    );
    const kept = await db.observabilityConnection.findUniqueOrThrow({ where: { id } });
    expect(kept.credentialEncrypted).toBe(row.credentialEncrypted);
    expect(kept.enabled).toBe(false);

    expect(await deleteObservabilityConnection(id, ui(admin.id))).toBe('deleted');
    expect(await deleteObservabilityConnection(id, ui(admin.id))).toBe('not_found');

    const audits = await db.auditLog.findMany({
      where: { entityId: id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map(entry => entry.action)).toEqual([
      'intelligence.connector.created',
      'intelligence.connector.updated',
      'intelligence.connector.deleted',
    ]);
    expect(JSON.stringify(audits)).not.toContain(SECRET);
    expect(JSON.stringify(audits[0].details)).toContain('credentialReplaced');
  });

  it('refuses to move a stored credential to another address without re-entering it', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const id = await addConnection(admin.id);
    await expect(
      saveObservabilityConnection(
        id,
        {
          name: 'Prometheus',
          kind: 'PROMETHEUS',
          baseUrl: 'http://127.0.0.1:1',
          allowPrivateNetwork: true,
        },
        ui(admin.id)
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('validates endpoints like AI providers: private needs consent, metadata never', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const base = { name: 'P', kind: 'PROMETHEUS', enabled: true };
    await expect(
      saveObservabilityConnection(null, { ...base, baseUrl: 'https://10.1.2.3' }, ui(admin.id))
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      saveObservabilityConnection(
        null,
        { ...base, baseUrl: 'http://169.254.169.254', allowPrivateNetwork: true },
        ui(admin.id)
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      saveObservabilityConnection(
        null,
        {
          ...base,
          baseUrl: backend.url,
          allowedTeamIds: ['missing-team'],
          allowPrivateNetwork: true,
        },
        ui(admin.id)
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await db.observabilityConnection.count()).toBe(0);
  });

  it('scopes connections to allowed teams; administrators see every enabled one', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const teamA = await createTestTeam('A');
    const teamB = await createTestTeam('B');
    const member = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { userId: member.id, teamId: teamA.id, role: 'MEMBER' } });
    const everyone = await addConnection(admin.id, { name: 'Everyone' });
    const mine = await addConnection(admin.id, { name: 'Team A', allowedTeamIds: [teamA.id] });
    const theirs = await addConnection(admin.id, { name: 'Team B', allowedTeamIds: [teamB.id] });
    const off = await addConnection(admin.id, { name: 'Off', enabled: false });

    const forMember = (await listEligibleConnections(await actorOf(member.id))).map(c => c.id);
    expect(forMember.sort()).toEqual([everyone, mine].sort());
    const forAdmin = (await listEligibleConnections(await actorOf(admin.id))).map(c => c.id);
    expect(forAdmin.sort()).toEqual([everyone, mine, theirs].sort());
    expect(forAdmin).not.toContain(off);

    // Evidence replay re-checks the same scope.
    const states = await readSourceStates(await actorOf(member.id), [
      { kind: 'observability', id: mine },
      { kind: 'observability', id: theirs },
    ]);
    expect([...states.keys()]).toEqual([`observability:${mine}`]);
  });

  it('tests a connection with a harmless read and maps a rejected credential', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const id = await addConnection(admin.id, { enabled: false });
    const ok = await testObservabilityConnection(id);
    expect(ok).toMatchObject({ ok: true });
    expect(backend.requests.at(-1)).toMatchObject({
      path: '/api/v1/status/buildinfo',
      method: 'GET',
      auth: `Bearer ${SECRET}`,
    });
    backend.status = 401;
    expect(await testObservabilityConnection(id)).toEqual({ ok: false, reason: 'REJECTED' });
    expect(await testObservabilityConnection('missing')).toEqual({
      ok: false,
      reason: 'NOT_FOUND',
    });
  });
});

async function setupAi(adminId: string) {
  await publishPolicyVersion(
    {},
    { mode: 'SUGGEST', definition: DEFAULT_POLICY_DEFINITION, expectedHeadVersion: 0 },
    ui(adminId)
  );
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  await updateAiSettings(
    {
      enabled: true,
      squireEnabled: true,
      squireName: 'Pip',
      allowExternalFallback: false,
      requestsPerMinutePerUser: 50,
      dailyTokenBudget: 500_000,
      maxOutputTokens: 512,
      requestTimeoutMs: 10_000,
      expectedRevision: 0,
    },
    ui(adminId)
  );
  await saveAiProvider(
    null,
    {
      name: 'Local',
      kind: 'OPENAI_COMPATIBLE',
      model: 'm',
      baseUrl: model.url,
      apiKey: 'k',
      enabled: true,
      isExternal: false,
      maxDataClass: 'PERSONAL',
      allowPrivateNetwork: true,
      priority: 1,
    },
    ui(adminId)
  );
  invalidateGatewayCache();
}

async function turn(userId: string, message: string): Promise<SquireEvent[]> {
  const events: SquireEvent[] = [];
  for await (const event of streamSquire(await actorOf(userId), { message, history: [] }))
    events.push(event);
  return events;
}
const toolNames = (index = 0) =>
  ((model.requests.at(index)?.body.tools as Array<{ function: { name: string } }>) ?? []).map(
    tool => tool.function.name
  );

describe('observability tools inside a Squire turn', () => {
  it('offers the tools only when an eligible connection exists', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    model.script.push({ content: 'ok' });
    await turn(admin.id, 'hello');
    expect(toolNames()).not.toContain('query_metrics');

    const id = await addConnection(admin.id, { enabled: false });
    model.script.push({ content: 'ok' });
    await turn(admin.id, 'hello');
    expect(toolNames(1)).not.toContain('query_metrics');

    await db.observabilityConnection.update({ where: { id }, data: { enabled: true } });
    model.script.push({ content: 'ok' });
    await turn(admin.id, 'hello');
    expect(toolNames(2)).toContain('query_metrics');
    expect(toolNames(2)).not.toContain('search_logs');

    // A person outside the allowed teams is not offered it.
    const team = await createTestTeam('Ops');
    await db.observabilityConnection.update({ where: { id }, data: { allowedTeamIds: [team.id] } });
    const outsider = await createTestUser({ role: 'USER' });
    model.script.push({ content: 'ok' });
    await turn(outsider.id, 'hello');
    expect(toolNames(3)).not.toContain('query_metrics');
  });

  it('queries metrics around the incident, returns a compact summary and records evidence', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    const id = await addConnection(admin.id);
    const team = await createTestTeam('Checkout');
    const service = await createTestService('Checkout', team.id);
    const incident = await createTestIncident('Checkout errors', service.id, { teamId: team.id });
    model.script.push(
      {
        toolCall: {
          name: 'query_metrics',
          args: JSON.stringify({
            query: 'sum(rate(checkout_errors[5m]))',
            incidentId: incident.id,
          }),
        },
      },
      { content: 'Errors jumped from 2 to 977.' }
    );
    const events = await turn(admin.id, 'are checkout errors up?');

    const query = backend.requests.find(request => request.path === '/api/v1/query_range');
    expect(query?.auth).toBe(`Bearer ${SECRET}`);
    const toolResult = JSON.stringify(model.requests[1].body);
    expect(toolResult).toContain('Untrusted data');
    expect(toolResult).toContain('977');
    expect(toolResult).not.toContain(SECRET);

    const memory = events.find(
      (event): event is Extract<SquireEvent, { type: 'memory' }> => event.type === 'memory'
    );
    expect(memory?.turn.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'observability', id })])
    );
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('classifies logs as Personal and redacts secrets before the model sees them', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    await addConnection(admin.id, { name: 'Loki', kind: 'LOKI' });
    const actor = await actorOf(admin.id);
    const tools = buildSquireTools(actor, {
      personal: false,
      observability: await listEligibleConnections(actor),
    });
    // Without Personal clearance the log tool is not offered at all.
    expect(tools.map(tool => tool.name)).not.toContain('search_logs');

    model.script.push(
      { toolCall: { name: 'search_logs', args: JSON.stringify({ query: '{app="checkout"}' }) } },
      { content: 'A payment failed.' }
    );
    const events = await turn(admin.id, 'any payment errors in the logs?');
    const toolResult = JSON.stringify(model.requests[1].body);
    expect(toolResult).toContain('payment failed');
    expect(toolResult).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    const memory = events.find(
      (event): event is Extract<SquireEvent, { type: 'memory' }> => event.type === 'memory'
    );
    expect(memory?.turn.dataClass).toBe('PERSONAL');
  });

  it('reads the diff behind a recorded change through the matching GitHub connection', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    const github = await addConnection(admin.id, { name: 'GitHub', kind: 'GITHUB' });
    const change = await db.changeEvent.create({
      data: {
        source: 'github',
        kind: 'DEPLOY',
        summary: 'Deploy checkout',
        url: `${backend.url}/acme/checkout/commit/abcdef1234567`,
        occurredAt: new Date(),
      },
    });
    const unrelated = await db.changeEvent.create({
      data: {
        source: 'github',
        kind: 'DEPLOY',
        summary: 'Elsewhere',
        url: 'https://github.com/acme/checkout/commit/abcdef1234567',
        occurredAt: new Date(),
      },
    });
    const actor = await actorOf(admin.id);
    const tools = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    });
    const diff = tools.find(tool => tool.name === 'get_change_diff')!;
    expect(diff.dataClass).toBe('INTERNAL');

    const result = (await diff.execute!({ changeId: change.id })) as Record<string, unknown>;
    expect(result).toMatchObject({
      connectionId: github,
      changeId: change.id,
      title: 'Lower connection pool',
      additions: 1,
      deletions: 1,
    });
    expect(String(result.patch)).toContain('+pool: 5');
    expect(await diff.execute!({ changeId: unrelated.id })).toEqual({
      error: 'No GitHub connection for github.com.',
    });
    expect(await diff.execute!({ changeId: 'missing' })).toEqual({
      error: 'Not found, or you do not have access to it.',
    });
  });

  it('discovers metric names and label values, capped, with validated names only', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    await addConnection(admin.id);
    const actor = await actorOf(admin.id);
    const tools = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    });
    const list = tools.find(tool => tool.name === 'list_metrics')!;
    const values = tools.find(tool => tool.name === 'label_values')!;
    expect(list.dataClass).toBe('INTERNAL');

    const names = (await list.execute!({ prefix: 'http_' })) as Record<string, unknown>;
    expect(names).toMatchObject({ prefix: 'http_', total: 60, truncated: true });
    expect(names.values).toHaveLength(50);
    expect(names.values).not.toContain('up');
    const asked = backend.requests.find(
      request => request.path === '/api/v1/label/__name__/values'
    );
    expect(asked?.auth).toBe(`Bearer ${SECRET}`);

    expect(await values.execute!({ metric: 'http_requests_00', label: 'job' })).toMatchObject({
      values: ['api', 'checkout'],
      total: 2,
      truncated: false,
    });
    // PromQL or regex in a name never reaches the backend.
    const before = backend.requests.length;
    expect(await list.execute!({ prefix: 'a"}or vector(1)' })).toHaveProperty('error');
    expect(await values.execute!({ metric: 'up', label: 'job"}' })).toHaveProperty('error');
    expect(backend.requests).toHaveLength(before);
  });

  it('caps search_logs at the summary limit in both the schema and the default', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    await addConnection(admin.id, { name: 'Loki', kind: 'LOKI' });
    const actor = await actorOf(admin.id);
    const logs = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    }).find(tool => tool.name === 'search_logs')!;
    const limit = (logs.inputSchema as { properties: Record<string, Record<string, unknown>> })
      .properties.limit;
    expect(limit).toMatchObject({ maximum: 15, default: 15 });
    expect(logs.description).toContain('at most 15');
    expect(await logs.execute!({ query: '{app="x"}', limit: 16 })).toEqual({
      error: 'Invalid input',
    });
  });

  it('lists saved metric queries only for readable services on usable connections', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    const prom = await addConnection(admin.id);
    const disabled = await addConnection(admin.id, { name: 'Off', enabled: false });
    const service = await createTestService('Checkout');
    const other = await createTestService('Billing');
    const incident = await createTestIncident('Checkout errors', service.id);
    await db.serviceMetricTemplate.createMany({
      data: [
        {
          serviceId: service.id,
          connectionId: prom,
          name: 'Error rate',
          query: 'rate(errors[5m])',
        },
        { serviceId: service.id, connectionId: disabled, name: 'Hidden', query: 'up' },
        { serviceId: other.id, connectionId: prom, name: 'Billing latency', query: 'latency' },
      ],
    });
    const actor = await actorOf(admin.id);
    const tool = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    }).find(item => item.name === 'list_metric_templates')!;
    expect(await tool.execute!({ incidentId: incident.id })).toEqual({
      templates: [
        {
          serviceId: service.id,
          serviceName: service.name,
          name: 'Error rate',
          query: 'rate(errors[5m])',
          connectionId: prom,
        },
      ],
    });
    expect(await tool.execute!({ incidentId: 'missing' })).toEqual({
      error: 'Not found, or you do not have access to it.',
    });
  });

  it('reads Kubernetes state read-only: stalled rollouts first, restarting pods, newest events, capped', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    const k8s = await addConnection(admin.id, { name: 'Cluster', kind: 'KUBERNETES' });
    const stored = await db.observabilityConnection.findUniqueOrThrow({ where: { id: k8s } });
    expect(stored.credentialEncrypted).not.toContain(SECRET);
    expect(await testObservabilityConnection(k8s)).toMatchObject({ ok: true });
    expect(backend.requests.at(-1)?.path).toBe('/api/v1/namespaces');

    const actor = await actorOf(admin.id);
    const tools = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    });
    expect(tools.map(tool => tool.name)).not.toContain('query_metrics');
    const state = tools.find(tool => tool.name === 'get_k8s_state')!;
    backend.requests.length = 0;
    const result = (await state.execute!({
      namespace: 'shop',
      labelSelector: 'app in (checkout,web)',
    })) as KubernetesSummary & { connectionId: string };
    expect(backend.requests.every(request => request.method === 'GET')).toBe(true);
    expect(backend.requests.every(request => request.auth === `Bearer ${SECRET}`)).toBe(true);
    expect(result.connectionId).toBe(k8s);
    expect(result.workloads[0]).toMatchObject({
      kind: 'Deployment',
      name: 'checkout',
      rollout: 'stalled',
      desired: 3,
      ready: 1,
    });
    expect(result.workloads[1]).toMatchObject({ name: 'web', rollout: 'complete' });
    expect(result.pods).toEqual([
      {
        name: 'checkout-7d-a',
        phase: 'Running',
        ready: false,
        restarts: 7,
        reason: 'CrashLoopBackOff',
        lastTermination: 'OOMKilled',
      },
    ]);
    expect(result.events).toHaveLength(15);
    expect(result.events[0].message).toContain('container 19');
    expect(result.truncated).toEqual({ workloads: false, pods: false, events: true });
    expect(JSON.stringify(result)).not.toContain('hunter2');

    const before = backend.requests.length;
    expect(await state.execute!({ namespace: '../secrets' })).toHaveProperty('error');
    expect(await state.execute!({ namespace: 'shop', labelSelector: 'a=b&x=1' })).toHaveProperty(
      'error'
    );
    expect(backend.requests).toHaveLength(before);
  });

  it('turns connector failures into neutral tool errors', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    await setupAi(admin.id);
    await addConnection(admin.id);
    backend.status = 500;
    const actor = await actorOf(admin.id);
    const tool = buildSquireTools(actor, {
      personal: true,
      observability: await listEligibleConnections(actor),
    }).find(item => item.name === 'query_metrics')!;
    expect(await tool.execute!({ query: 'up' })).toEqual({
      error: 'The connection rejected the query. Check the query syntax for this backend.',
    });
    expect(await tool.execute!({ query: 'up', minutes: 99_999 })).toEqual({
      error: 'Invalid input',
    });
  });
});
