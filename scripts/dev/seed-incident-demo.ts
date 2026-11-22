/**
 * Makes ONE incident look like a real, busy incident for LOCAL design work on the incident page.
 *
 *   npm run seed:incident-demo                       # "Checkout API: card authorization timeouts"
 *   npm run seed:incident-demo -- --id=<incidentId>
 *
 * Writes (idempotent, safe to re-run):
 *  - description: a realistic Datadog-style alert payload (JSON)
 *  - alerts: 6 deduplicated alerts with payloads on one dedup key
 *  - intelligence: settings on + global SUGGEST policy (only if none exists), two precedent
 *    incidents, two change events, similar / change / triage findings, an AI briefing
 *  - incident context: an automation version + LIVE decision with recognized / missing / unmapped fields
 *
 * Direct Prisma writes for development only. Findings and the briefing use generation 1_000_000 so a
 * running intelligence worker treats its own (lower-generation) results as stale and keeps these.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { buildResponseContext } from '../../src/lib/automation/response-context';

const prisma = new PrismaClient();
const DEMO = 'incident-demo:';
const GENERATION = 1_000_000;
const DEFAULT_TITLE = 'Checkout API: card authorization timeouts';

const arg = (name: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

async function main() {
  const id = arg('id');
  const incident = id
    ? await prisma.incident.findUnique({ where: { id } })
    : await prisma.incident.findFirst({
        where: { title: DEFAULT_TITLE },
        orderBy: { createdAt: 'desc' },
      });
  if (!incident) throw new Error(id ? `No incident ${id}` : `No incident titled "${DEFAULT_TITLE}"`);
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' } });
  if (!admin) throw new Error('No active ADMIN user; run the main seed first.');
  const serviceId = incident.serviceId;
  const t0 = incident.createdAt.getTime();
  const min = (m: number) => new Date(t0 + m * 60_000);
  const dedupKey = `datadog:monitor:8841213:${serviceId.slice(-6)}:prod`;

  // 1. Description as a real alert payload, and the incident's dedup key.
  const payload = {
    id: '7349216650104451208',
    source: 'datadog',
    alert_type: 'error',
    title: '[Triggered] checkout 5xx rate above 5% on POST /v1/checkout',
    monitor: { id: 8841213, name: 'checkout 5xx rate', priority: 'P1', type: 'query alert' },
    query: 'sum(last_5m):sum:trace.http.request.errors{service:checkout-api,env:prod}.as_rate() / sum:trace.http.request.hits{service:checkout-api,env:prod}.as_rate() > 0.05',
    value: 0.184,
    threshold: 0.05,
    tags: ['env:prod', 'service:checkout-api', 'region:us-east-1', 'team:payments', 'endpoint:post_/v1/checkout', 'kube_namespace:payments-prod'],
    host: 'checkout-api-7f9c',
    hosts_affected: ['checkout-api-7f9c', 'checkout-api-5b21', 'checkout-api-2c04', 'checkout-api-91aa'],
    started_at: new Date(t0).toISOString(),
    links: {
      monitor: 'https://app.datadoghq.com/monitors/8841213',
      dashboard: 'https://app.datadoghq.com/dashboard/abc-123/checkout',
      runbook: 'https://wiki.example.com/runbooks/checkout-5xx',
    },
    message: 'Error rate on POST /v1/checkout is 18.4% (threshold 5%). Card authorizations are timing out after 8s. @pagerduty-payments',
  };
  await prisma.incident.update({
    where: { id: incident.id },
    data: { description: JSON.stringify(payload, null, 2), dedupKey },
  });

  // 2. Deduplicated alerts on that key.
  await prisma.alert.deleteMany({ where: { incidentId: incident.id, dedupKey } });
  const alertRows = [
    [0, 'TRIGGERED', 'checkout-api-7f9c', 'us-east-1', 0.062],
    [4, 'TRIGGERED', 'checkout-api-5b21', 'us-east-1', 0.121],
    [9, 'RESOLVED', 'checkout-api-2c04', 'us-east-1', 0.048],
    [17, 'TRIGGERED', 'checkout-api-7f9c', 'eu-west-1', 0.129],
    [19, 'TRIGGERED', 'checkout-api-5b21', 'us-east-1', 0.186],
    [21, 'TRIGGERED', 'checkout-api-7f9c', 'us-east-1', 0.181],
  ] as const;
  await prisma.alert.createMany({
    data: alertRows.map(([m, status, host, region, value]) => ({
      incidentId: incident.id,
      serviceId,
      dedupKey,
      status,
      severity: status === 'RESOLVED' ? 'warning' : 'critical',
      resourceKey: host,
      labels: { env: 'prod', region, host },
      createdAt: min(m),
      payload: { ...payload, host, value, status: status.toLowerCase(), tags: [...payload.tags.filter(t => !t.startsWith('region:')), `region:${region}`] },
    })),
  });

  // 3. Intelligence switched on (settings + a global SUGGEST policy, only if no policy exists yet).
  await prisma.intelligenceSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', enabled: true },
    update: { enabled: true },
  });
  if (!(await prisma.intelligencePolicy.findUnique({ where: { scopeKey: 'global' } }))) {
    const policy = await prisma.intelligencePolicy.create({ data: { scopeKey: 'global', headVersion: 1 } });
    await prisma.intelligencePolicyVersion.create({
      data: {
        policyId: policy.id,
        version: 1,
        mode: 'SUGGEST',
        definition: { schemaVersion: 1, triage: { enabled: true } },
        createdById: admin.id,
      },
    });
  }

  // 4. Two resolved precedents on the same service, and two changes before the incident.
  const precedent = async (key: string, title: string, daysAgo: number, minutes: number) => {
    const existing = await prisma.incident.findFirst({ where: { dedupKey: `${DEMO}${key}` } });
    if (existing) return existing;
    const createdAt = new Date(t0 - daysAgo * 86_400_000);
    return prisma.incident.create({
      data: {
        title,
        serviceId,
        status: 'RESOLVED',
        urgency: 'HIGH',
        priority: 'P1',
        dedupKey: `${DEMO}${key}`,
        createdAt,
        acknowledgedAt: new Date(createdAt.getTime() + 4 * 60_000),
        resolvedAt: new Date(createdAt.getTime() + minutes * 60_000),
      },
    });
  };
  const p1 = await precedent('p1', 'Checkout API 5xx after deploy (pool exhaustion)', 23, 31);
  const p2 = await precedent('p2', 'Checkout timeouts: payments-db pool saturated', 61, 48);
  const change = (key: string, summary: string, kind: 'DEPLOY' | 'CONFIG', minutesBefore: number) =>
    prisma.changeEvent.upsert({
      where: { source_dedupKey: { source: 'ci', dedupKey: `${DEMO}${key}` } },
      create: { source: 'ci', dedupKey: `${DEMO}${key}`, serviceId, kind, summary, occurredAt: min(-minutesBefore) },
      update: { serviceId, summary, occurredAt: min(-minutesBefore) },
    });
  const deploy = await change('deploy', 'Deploy checkout-api v2.41.0 (9f3c2e1)', 'DEPLOY', 12);
  const config = await change('config', 'payments-db max_connections 200 → 120', 'CONFIG', 1080);

  // 5. Findings the strip and inspector read.
  await prisma.intelligenceFinding.deleteMany({ where: { incidentId: incident.id, generation: GENERATION } });
  const common = { incidentId: incident.id, generation: GENERATION, engineVersion: 'demo-seed', policyVersion: 1 };
  const similarity = (tokens: number) => ({
    type: 'similarity', calibrated: false, tier: 'FTS',
    components: { tokens, template: 0.9, labels: 0.5, sameService: 1, recency: 0.6, resolved: 1 },
    matchedTokenCount: 6,
  });
  await prisma.intelligenceFinding.createMany({
    data: [
      { ...common, kind: 'SIMILAR_INCIDENT', rank: 1, confidence: 0.82, subjectRef: p1.id, evidence: similarity(0.86) },
      { ...common, kind: 'SIMILAR_INCIDENT', rank: 2, confidence: 0.64, subjectRef: p2.id, evidence: similarity(0.62) },
      {
        ...common, kind: 'CHANGE_CORRELATION', rank: 1, confidence: 0.72, subjectRef: deploy.id,
        evidence: { type: 'change', calibrated: false, kind: 'DEPLOY', relation: 'SAME_SERVICE', depth: 0, leadSeconds: 720, components: { proximity: 0.82, relation: 1, kind: 1 } },
      },
      { ...common, kind: 'TRIAGE_URGENCY', rank: 1, confidence: 0.71, subjectRef: 'HIGH', evidence: { voters: 5 } },
    ] as Prisma.IntelligenceFindingCreateManyInput[],
  });

  // 6. The AI briefing (shape must match briefingContentSchema exactly).
  const briefing = {
    v: 1,
    headline: 'Checkout 5xx at 18% since start; deploy v2.41.0 landed 12 min before',
    facts: [
      '6 alerts deduplicated on one key, 4 hosts, 2 regions',
      'Error rate 6.2% → 18.4% on POST /v1/checkout',
      'payments-db connections at 118 of 120',
    ],
    analysisPending: false,
    refs: {
      similar: [
        { id: p1.id, label: p1.title, matchPercent: 82, resolution: 'Rolled back the deploy' },
        { id: p2.id, label: p2.title, matchPercent: 64, resolution: 'Raised the pool limit' },
      ],
      changes: [
        { id: deploy.id, label: deploy.summary, minutesBefore: 12 },
        { id: config.id, label: config.summary, minutesBefore: 1080 },
      ],
      runbooks: [],
    },
    ai: {
      model: 'claude-sonnet-5-5',
      headline: 'Checkout is failing for ~18% of card payments, starting 12 minutes after v2.41.0 deployed.',
      currentState:
        'Card authorizations time out after 8s in us-east-1 and eu-west-1. payments-db connections sit at 118 of 120 after the limit was cut from 200 yesterday. Escalation reached its last step and nobody has acknowledged yet.',
      possibleCauses: [
        'v2.41.0 opens more DB connections per pod and exhausts the pool',
        'The lowered pool limit (200 → 120) leaves no headroom at peak',
      ],
      nextSteps: [
        'Acknowledge and take command',
        'Roll back checkout-api to v2.40.3 (worked last time)',
        'Post a status-page update for Checkout',
      ],
      inputRefs: { incidents: [p1.id, p2.id], changes: [deploy.id, config.id], runbooks: [] },
    },
  };
  await prisma.squireProactiveNote.upsert({
    where: { incidentId_kind: { incidentId: incident.id, kind: 'BRIEFING' } },
    create: { incidentId: incident.id, kind: 'BRIEFING', mode: 'AI', content: briefing, generation: GENERATION, model: 'claude-sonnet-5-5' },
    update: { mode: 'AI', content: briefing, generation: GENERATION, model: 'claude-sonnet-5-5' },
  });

  // 7. Incident context: a published automation version and the LIVE decision that captured it.
  // Published versions and decisions are immutable (DB trigger): create once, never update.
  const version =
    (await prisma.automationVersion.findUnique({
      where: { serviceId_versionNumber: { serviceId, versionNumber: 3 } },
    })) ??
    (await prisma.automationVersion.create({
      data: {
      serviceId, versionNumber: 3, schemaVersion: 1,
      snapshot: { schemaVersion: 1, fields: [], rules: [] },
      compiledSnapshot: { schemaVersion: 1, fields: [], rules: [] },
      checksum: 'demo-seed', publishedBy: admin.id, lintReport: [],
      },
    }));
  const field = (key: string) => ({ fieldId: `f-${key}`, key, type: 'STRING' as const });
  const recognized = (value: string) => ({ state: 'RECOGNIZED' as const, value });
  const context = buildResponseContext({
    versionId: version.id,
    versionNumber: version.versionNumber,
    fields: ['env', 'region', 'endpoint', 'monitor', 'host', 'team', 'customer_tier', 'k8s_namespace'].map(field),
    inputContext: {
      env: recognized('prod'), region: recognized('us-east-1'), endpoint: recognized('POST /v1/checkout'),
      monitor: recognized('checkout 5xx rate (8841213)'), host: recognized('checkout-api-7f9c'),
      k8s_namespace: { state: 'UNMAPPED', raw: 'payments-prod' },
    },
    enrichedContext: {
      env: recognized('prod'), region: recognized('us-east-1'), endpoint: recognized('POST /v1/checkout'),
      monitor: recognized('checkout 5xx rate (8841213)'), host: recognized('checkout-api-7f9c'),
      team: recognized('payments'), k8s_namespace: { state: 'UNMAPPED', raw: 'payments-prod' },
    },
  } as Parameters<typeof buildResponseContext>[0]);
  const service = await prisma.service.findUnique({ where: { id: serviceId }, select: { escalationPolicyId: true } });
  const decision = {
    serviceId, versionId: version.id, escalationPolicyId: service?.escalationPolicyId ?? null, mode: 'LIVE' as const, routeType: 'SERVICE_DEFAULT' as const,
    matchedRouteRuleName: 'payments-high', basePriority: 'P2', finalPriority: 'P1',
    evaluationAt: incident.createdAt, summary: {}, fallbackReason: null,
    responseContext: context as unknown as Prisma.InputJsonValue,
  };
  if (!(await prisma.incidentAutomationDecision.findUnique({ where: { incidentId: incident.id } })))
    await prisma.incidentAutomationDecision.create({ data: { incidentId: incident.id, ...decision } });

  console.log(`Seeded demo data on "${incident.title}" (${incident.id}): payload description, ${alertRows.length} alerts, AI briefing, findings, context.`);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
