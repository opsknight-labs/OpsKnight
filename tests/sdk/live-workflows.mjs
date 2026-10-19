import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { Client } from '../../sdk/typescript/dist/client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error('Live SDK certification requires a dedicated database whose name ends in _test.');
}
const port = Number(process.env.API_SDK_TEST_PORT ?? 3159);
if (!Number.isInteger(port) || port < 1024 || port > 65534)
  throw new Error('Invalid API_SDK_TEST_PORT.');
const secret = randomBytes(32).toString('hex');
const token = `ok_test_${randomBytes(32).toString('base64url')}`;
const prisma = new PrismaClient();
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
let keyId;
let pythonKeyId;
let worker;
const runtimeEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  HOSTNAME: '0.0.0.0',
  NEXTAUTH_SECRET: randomBytes(48).toString('base64url'),
  API_KEY_SECRET: secret,
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  APP_HOST_ALIASES: 'host.docker.internal',
  NEXTAUTH_URL: `http://127.0.0.1:${port}`,
  NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
};
const server = spawn(process.execPath, ['.next/standalone/server.js'], {
  env: { ...runtimeEnvironment, OPSKNIGHT_PROCESS_ROLE: 'web' },
  stdio: 'ignore',
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error('Built application exited before readiness.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v2/openapi.json`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        await response.body?.cancel();
        ready = true;
        break;
      }
      await response.body?.cancel();
    } catch {
      /* The application is still starting. */
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Built application did not become ready.');
  const user = await prisma.user.create({
    data: {
      name: 'Live SDK certifier',
      email: `sdk-${randomUUID()}@example.com`,
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });
  const key = await prisma.apiKey.create({
    data: {
      name: 'Ephemeral live SDK certification',
      userId: user.id,
      prefix: token.slice(0, 12),
      tokenHash: createHmac('sha256', secret).update(`opsknight:api-key:v2:${token}`).digest('hex'),
      scopes: [
        'admin:manage',
        'service-objectives:read',
        'service-objectives:write',
        'service-objectives:evaluate',
        'status-page-subscribers:read',
        'status-page-subscribers:write',
        'status-pages:read',
        'status-pages:write',
        'runbook-rules:read',
        'runbook-rules:write',
        'runbook-rules:activate',
        'runbooks:read',
        'runbooks:write',
        'runbooks:publish',
        'runbooks:execute',
        'runbooks:approve',
        'automation:read',
        'automation:write',
        'automation:publish',
        'automation-settings:read',
        'automation-settings:write',
        'incidents:read',
      ],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  keyId = key.id;
  const client = new Client({
    baseUrl: `http://127.0.0.1:${port}/api/v2`,
    token,
    allowInsecureHttp: true,
  });
  const suffix = randomUUID();
  const request = {
    body: { name: 'TypeScript live SDK verification', slug: `typescript-sdk-${suffix}` },
    headers: { 'Idempotency-Key': `create-${suffix}` },
  };
  const created = await client.call('createRunbook', request);
  const replay = await client.call('createRunbook', request);
  if (created.data.id !== replay.data.id)
    throw new Error('Live create replay duplicated a runbook.');
  const params = { id: created.data.id, versionId: created.data.draftVersionId };
  await client.call('validateRunbookDraft', { params, body: {} });
  const published = await client.call('publishRunbookDraft', {
    params,
    body: {},
    headers: { 'If-Match': '"0"', 'Idempotency-Key': `publish-${suffix}` },
  });
  if (published.data.state !== 'PUBLISHED') throw new Error('Live runbook publication failed.');
  const preview = await client.call('previewRunbookExecution', {
    params: { id: created.data.id },
    body: {},
  });
  const execution = await client.call('executeRunbook', {
    params: { id: created.data.id },
    body: { expectedPlanDigest: preview.data.digest },
    headers: { 'Idempotency-Key': `execute-${suffix}` },
  });
  const cancellation = await client.call('cancelRunbookExecution', {
    params: { id: execution.data.executionId },
    body: { reason: 'Live SDK certification complete' },
    headers: { 'Idempotency-Key': `cancel-${suffix}` },
  });
  if (cancellation.data.status !== 'CANCEL_REQUESTED')
    throw new Error('Live cancellation did not preserve request semantics.');
  console.log(
    'TypeScript live replay/publication/preview/execution/cancellation workflows passed.'
  );
  const lifecycle = await client.call('createRunbook', {
    body: { name: 'TypeScript lifecycle', slug: `ts-lifecycle-${suffix}` },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  const lifecycleParams = { id: lifecycle.data.id };
  const metadata = await client.call('getRunbookMetadata', { params: lifecycleParams });
  const changed = await client.call('updateRunbookMetadata', {
    params: lifecycleParams,
    body: { description: 'Reviewed through SDK' },
    headers: { 'If-Match': `"${metadata.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  const archived = await client.call('archiveRunbook', {
    params: lifecycleParams,
    body: {},
    headers: { 'If-Match': `"${changed.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  if (!archived.data.archivedAt) throw new Error('SDK archive failed.');
  const restored = await client.call('restoreRunbook', {
    params: lifecycleParams,
    body: {},
    headers: { 'If-Match': `"${archived.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  if (restored.data.archivedAt) throw new Error('SDK restore failed.');
  const copy = await client.call('duplicateRunbook', {
    params: lifecycleParams,
    body: {},
    headers: { 'If-Match': `"${restored.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  const comparison = await client.call('compareRunbookVersions', {
    params: { id: created.data.id, versionId: published.data.id },
    query: { baseVersionId: published.data.id },
  });
  if (comparison.data.steps.some(step => step.change !== 'UNCHANGED'))
    throw new Error('Self comparison changed steps.');
  const eligibility = await client.call('checkRunbookDeletion', { params: { id: copy.data.id } });
  if (!eligibility.data.canDelete) throw new Error('Independent draft copy cannot be deleted.');
  await client.call('deleteRunbook', {
    params: { id: copy.data.id },
    body: { confirmationText: copy.data.name },
    headers: { 'If-Match': `"${copy.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  console.log(
    'TypeScript live metadata/archive/restore/duplicate/comparison/deletion workflows passed.'
  );
  const ruleService = await prisma.service.create({
    data: { name: `SDK service rules ${randomUUID()}` },
  });
  const ruleAgent = await prisma.runbookAgent.create({
    data: {
      name: 'SDK policy Agent',
      status: 'ONLINE',
      lastHeartbeatAt: new Date(),
      policyHash: 'a'.repeat(64),
      capabilities: ['RUNBOOK_LINUX_DIAGNOSTICS'],
    },
  });
  const rule = await client.call('createServiceRunbookRule', {
    params: { id: ruleService.id },
    body: {
      configuration: {
        runbookId: created.data.id,
        runbookVersionId: published.data.id,
        mode: 'AUTOMATIC',
        versionStrategy: 'PINNED',
      },
      expectedVersionId: published.data.id,
      trigger: { event: 'INCIDENT_CREATED', conditions: [] },
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  const ruleParams = { id: ruleService.id, ruleId: rule.data.id };
  let currentRule = (await client.call('getServiceRunbookRule', { params: ruleParams })).data;
  const review = await client.call('validateServiceRunbookRule', { params: ruleParams, body: {} });
  if (review.data.configurationRevision !== currentRule.configurationRevision)
    throw new Error('Rule readiness reviewed a different revision.');
  currentRule = (
    await client.call('replaceRunbookRuleTriggers', {
      params: ruleParams,
      body: {
        event: 'INCIDENT_CREATED',
        conditions: [{ field: 'incident.urgency', operator: 'EQUALS', value: 'HIGH' }],
      },
      headers: {
        'If-Match': `"${currentRule.configurationRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    })
  ).data;
  currentRule = (
    await client.call('activateServiceRunbookRule', {
      params: ruleParams,
      body: { confirmMatchAll: false },
      headers: {
        'If-Match': `"${currentRule.configurationRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    })
  ).data;
  if (!currentRule.enabled) throw new Error('SDK rule activation failed.');
  currentRule = (
    await client.call('updateServiceRunbookRule', {
      params: ruleParams,
      body: { configuration: { name: 'Reviewed SDK rule' }, expectedVersionId: published.data.id },
      headers: {
        'If-Match': `"${currentRule.configurationRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    })
  ).data;
  if (currentRule.enabled) throw new Error('Rule edits did not pause Automatic execution.');
  currentRule = (
    await client.call('pauseServiceRunbookRule', {
      params: ruleParams,
      body: {},
      headers: {
        'If-Match': `"${currentRule.configurationRevision}"`,
        'Idempotency-Key': randomUUID(),
      },
    })
  ).data;
  const ruleCopy = await client.call('duplicateServiceRunbookRule', {
    params: ruleParams,
    body: {},
    headers: {
      'If-Match': `"${currentRule.configurationRevision}"`,
      'Idempotency-Key': randomUUID(),
    },
  });
  if (ruleCopy.data.enabled || ruleCopy.data.id === currentRule.id)
    throw new Error('Rule duplicate is not independent and paused.');
  const ruleList = await client.call('listServiceRunbookRules', {
    params: { id: ruleService.id },
    query: { limit: 1 },
  });
  if (ruleList.data.length !== 1 || 'inputValues' in ruleList.data[0])
    throw new Error('Rule list is not a bounded summary.');
  await client.call('detachServiceRunbookRule', {
    params: { id: ruleService.id, ruleId: ruleCopy.data.id },
    body: {},
    headers: {
      'If-Match': `"${ruleCopy.data.configurationRevision}"`,
      'Idempotency-Key': randomUUID(),
    },
  });
  const policyBook = await client.call('createRunbook', {
    body: {
      name: 'SDK policy workflow',
      slug: `sdk-policy-${suffix}`,
      definition: {
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: 'LINUX_DIAGNOSTICS',
            riskClass: 'READ_ONLY',
            config: { action: 'summary' },
          },
        ],
      },
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  const policyVersion = await client.call('publishRunbookDraft', {
    params: { id: policyBook.data.id, versionId: policyBook.data.draftVersionId },
    body: {},
    headers: { 'If-Match': '"0"', 'Idempotency-Key': randomUUID() },
  });
  const policyRule = await client.call('createServiceRunbookRule', {
    params: { id: ruleService.id },
    body: {
      configuration: {
        runbookId: policyBook.data.id,
        runbookVersionId: policyVersion.data.id,
        versionStrategy: 'PINNED',
        mode: 'MANUAL',
        enabled: false,
        defaultAgentId: ruleAgent.id,
      },
      expectedVersionId: policyVersion.data.id,
    },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  const policyParams = { id: ruleService.id, ruleId: policyRule.data.id };
  const policyRequest = await client.call('requestRunbookRulePolicyChecks', {
    params: policyParams,
    body: {},
    headers: {
      'If-Match': `"${policyRule.data.configurationRevision}"`,
      'Idempotency-Key': randomUUID(),
    },
  });
  if (
    policyRequest.data.checkedTargets !== 1 ||
    policyRequest.data.status !== 'PENDING' ||
    policyRequest.data.checkIds.length !== 1
  )
    throw new Error('SDK policy request did not freeze one target.');
  const policyChecks = await client.call('listRunbookRulePolicyChecks', { params: policyParams });
  if (
    policyChecks.data.length !== 1 ||
    'steps' in policyChecks.data[0] ||
    'results' in policyChecks.data[0]
  )
    throw new Error('Policy-check metadata exposed internal configuration.');
  console.log(
    'TypeScript live service-rule authoring/revision/readiness/activation/policy-check workflows passed.'
  );
  const automationService = await prisma.service.create({
    data: { name: `Python automation ${randomUUID()}` },
  });
  const statusPage =
    (await prisma.statusPage.findFirst({ select: { id: true } })) ??
    (await prisma.statusPage.create({
      data: { name: `SDK status ${randomUUID()}`, slug: `sdk-${randomUUID()}` },
    }));
  for (const [readOperation, writeOperation, changes] of [
    [
      'getStatusPageContent',
      'updateStatusPageContent',
      { footerText: `SDK footer ${randomUUID()}` },
    ],
    [
      'getStatusPageSettings',
      'updateStatusPageSettings',
      { organizationName: `SDK organization ${randomUUID()}` },
    ],
    [
      'getStatusPageAppearance',
      'updateStatusPageAppearance',
      { branding: { primaryColor: '#123456' } },
    ],
    ['getStatusPagePrivacy', 'updateStatusPagePrivacy', { showIncidentTitles: false }],
  ]) {
    const detail = await client.call(readOperation, { params: { id: statusPage.id } });
    const changed = await client.call(writeOperation, {
      params: { id: statusPage.id },
      body: changes,
      headers: { 'Idempotency-Key': randomUUID(), 'If-Match': `"${detail.data.revision}"` },
    });
    if (changed.data.revision < detail.data.revision || !changed.data.publication.status)
      throw new Error('Status configuration revision/publication missing.');
  }
  const statusConfig = (
    await client.call('getStatusPageSettings', { params: { id: statusPage.id } })
  ).data;
  const selectedServices = await client.call('setStatusPageServices', {
    params: { id: statusPage.id },
    body: {
      serviceIds: [ruleService.id],
      serviceConfigs: {
        [ruleService.id]: { displayName: 'SDK component', showOnPage: true, order: 0 },
      },
    },
    headers: { 'Idempotency-Key': randomUUID(), 'If-Match': `"${statusConfig.revision}"` },
  });
  await client.call('updateStatusPageService', {
    params: { id: statusPage.id, serviceId: ruleService.id },
    body: { displayName: 'SDK reviewed component' },
    headers: { 'Idempotency-Key': randomUUID(), 'If-Match': `"${selectedServices.data.revision}"` },
  });
  const components = await client.call('listStatusPageServices', {
    params: { id: statusPage.id },
    query: { limit: 1 },
  });
  if (components.data[0].displayName !== 'SDK reviewed component')
    throw new Error('Status service presentation did not persist.');
  console.log('TypeScript live status-page configuration, privacy and service components passed.');
  const publication = await client.call('getStatusPagePublication', {
    params: { id: statusPage.id },
  });
  const publicationRetry = await client.call('retryStatusPagePublication', {
    params: { id: statusPage.id },
    body: {},
    headers: { 'Idempotency-Key': randomUUID(), 'If-Match': `"${publication.data.revision}"` },
  });
  if (publicationRetry.data.status !== 'PENDING')
    throw new Error('Publication retry was not durably accepted.');
  const publicationJob = await client.call('getStatusPagePublicationJob', {
    params: { id: statusPage.id, jobId: publicationRetry.data.id },
  });
  if (publicationJob.data.id !== publicationRetry.data.id || publicationJob.data.result !== null)
    throw new Error('Publication job inspection failed.');
  console.log(
    'TypeScript live status-page publication inspection and durable retry acceptance passed.'
  );

  const tsSubscriber = await prisma.statusPageSubscription.create({
    data: {
      statusPageId: statusPage.id,
      email: `ts-${randomUUID()}@example.com`,
      token: randomUUID(),
      state: 'ACTIVE',
      verified: true,
    },
  });
  const pySubscriber = await prisma.statusPageSubscription.create({
    data: {
      statusPageId: statusPage.id,
      email: `py-${randomUUID()}@example.com`,
      token: randomUUID(),
      state: 'ACTIVE',
      verified: true,
    },
  });
  const subscriberParams = { id: statusPage.id, subscriberId: tsSubscriber.id };
  const subscriberRows = [];
  for await (const row of client.paginate(
    'listStatusPageSubscribers',
    { params: { id: statusPage.id }, query: { limit: 1 } },
    1000
  ))
    subscriberRows.push(row);
  if (!subscriberRows.some(row => row.id === tsSubscriber.id))
    throw new Error('Subscriber cursor omitted fixture.');
  const subscriberDetail = (
    await client.call('getStatusPageSubscriber', { params: subscriberParams })
  ).data;
  if (
    subscriberDetail.email !== tsSubscriber.email ||
    'token' in subscriberDetail ||
    'verificationToken' in subscriberDetail
  )
    throw new Error('Unsafe subscriber representation.');
  await client.call('getStatusPageSubscriberStats', { params: { id: statusPage.id } });
  await client.call('getStatusPageSubscriptionSettings', { params: { id: statusPage.id } });
  await client.call('removeStatusPageSubscriber', {
    params: subscriberParams,
    headers: { 'Idempotency-Key': randomUUID() },
  });
  if (
    (await prisma.statusPageSubscription.findUniqueOrThrow({ where: { id: tsSubscriber.id } }))
      .state !== 'UNSUBSCRIBED'
  )
    throw new Error('Subscriber revocation missing.');
  console.log('TypeScript live status-page subscriber administration passed.');
  worker = spawn(process.execPath, ['.next/standalone/server.js'], {
    env: {
      ...runtimeEnvironment,
      PORT: String(port + 1),
      OPSKNIGHT_PROCESS_ROLE: 'general-worker',
    },
    stdio: 'ignore',
  });
  async function interventionFixture(status = 'WAITING_APPROVAL') {
    return prisma.runbookExecution.create({
      data: {
        runbookId: created.data.id,
        runbookVersionId: published.data.id,
        definitionChecksum: published.data.checksum,
        triggeredByUserId: user.id,
        status,
        deadlineAt: new Date(Date.now() + 10 * 60_000),
        ...(status === 'WAITING_APPROVAL'
          ? {
              steps: {
                create: {
                  stepKey: 'review',
                  name: 'Review SDK action',
                  sequence: 0,
                  type: 'APPROVAL',
                  riskClass: 'READ_ONLY',
                  config: {},
                  status: 'WAITING_APPROVAL',
                  requiresApproval: true,
                },
              },
            }
          : { completedAt: new Date() }),
      },
    });
  }
  const approveSource = await interventionFixture();
  const rejectSource = await interventionFixture();
  const rerunSource = await interventionFixture('SUCCEEDED');
  for (const [source, operation] of [
    [approveSource, 'approveRunbookExecutionStep'],
    [rejectSource, 'rejectRunbookExecutionStep'],
  ]) {
    const reviewed = await client.call('listRunbookExecutionSteps', { params: { id: source.id } });
    const step = reviewed.data[0];
    if (!step.pendingApproval?.planDigest || 'config' in step)
      throw new Error('Invalid SDK approval projection.');
    const request = {
      params: { id: source.id, stepId: step.id },
      body: {
        planDigest: step.pendingApproval.planDigest,
        ...(operation === 'rejectRunbookExecutionStep' ? { reason: 'Reviewed SDK rejection' } : {}),
      },
      headers: { 'Idempotency-Key': randomUUID() },
    };
    await client.call(operation, request);
    await client.call(operation, request);
    await client.call('listRunbookExecutionEvidence', { params: { id: source.id } });
    await client.call('listRunbookExecutionEvents', { params: { id: source.id } });
  }
  const rerunPreview = await client.call('previewRunbookExecutionRerun', {
    params: { id: rerunSource.id },
    body: {},
  });
  if ('inputs' in rerunPreview.data || rerunPreview.data.steps.some(step => 'config' in step))
    throw new Error('Rerun preview disclosed private inputs/configuration.');
  const rerunRequest = {
    params: { id: rerunSource.id },
    body: {
      expectedPlanDigest: rerunPreview.data.digest,
      previewAuthorizationToken: rerunPreview.data.authorizationToken,
    },
    headers: { 'Idempotency-Key': randomUUID() },
  };
  const rerunAccepted = await client.call('rerunRunbookExecution', rerunRequest);
  if (
    (await client.call('rerunRunbookExecution', rerunRequest)).data.executionId !==
    rerunAccepted.data.executionId
  )
    throw new Error('Rerun retry created a duplicate execution.');
  const pythonApproveSource = await interventionFixture();
  const pythonRejectSource = await interventionFixture();
  console.log(
    'TypeScript reviewed runbook decisions, evidence/events and exact-preview rerun passed.'
  );
  const objectiveCatalog = await client.call('getServiceObjectiveCatalog', {});
  if (objectiveCatalog.data.metrics.length !== 4) throw new Error('Objective catalog mismatch.');
  const objectiveRequest = {
    body: {
      definition: {
        serviceId: ruleService.id,
        name: 'TypeScript response objective',
        metricType: 'MTTA',
        target: 30,
        comparator: 'LESS_THAN_OR_EQUAL',
        windowType: 'SEVEN_DAYS',
      },
      expectedActiveVersionId: null,
    },
    headers: { 'Idempotency-Key': randomUUID() },
  };
  const objective = await client.call('createServiceObjective', objectiveRequest);
  if ((await client.call('createServiceObjective', objectiveRequest)).data.id !== objective.data.id)
    throw new Error('Objective replay duplicated a definition.');
  const objectiveParams = { id: objective.data.id };
  await client.call('listServiceObjectives', { query: { serviceId: ruleService.id, limit: 1 } });
  await client.call('getServiceObjective', { params: objectiveParams });
  const editedObjective = await client.call('updateServiceObjective', {
    params: objectiveParams,
    body: { target: 20 },
    headers: { 'If-Match': `"${objective.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  for (const operation of [
    'listServiceObjectiveVersions',
    'listServiceObjectiveSnapshots',
    'getServiceObjectiveHistory',
  ])
    await client.call(operation, { params: objectiveParams });
  const evaluation = await client.call('evaluateServiceObjective', {
    params: objectiveParams,
    body: { expectedVersionId: editedObjective.data.versionId },
    headers: { 'Idempotency-Key': randomUUID() },
  });
  let completed = false;
  const evaluationDeadline = Date.now() + 50_000;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (Date.now() >= evaluationDeadline)
      throw new Error('Objective evaluation exceeded its 50-second completion budget.');
    if (worker.exitCode !== null) throw new Error('Objective worker exited.');
    const result = await client.call('getServiceObjectiveEvaluation', {
      params: { ...objectiveParams, evaluationId: evaluation.data.id },
    });
    if (result.data.status === 'COMPLETED') {
      if (
        result.data.result?.outcome !== 'EVALUATED' ||
        result.data.result.evaluation?.definitionVersion !== 2
      )
        throw new Error('Worker did not evaluate the immutable requested definition.');
      completed = true;
      break;
    }
    if (result.data.status === 'FAILED') throw new Error('Objective evaluation failed.');
    await new Promise(resolve => setTimeout(resolve, Math.min(500 * 1.3 ** attempt, 2000)));
  }
  if (!completed) throw new Error('Objective evaluation did not complete.');
  await client.call('archiveServiceObjective', {
    params: objectiveParams,
    body: {},
    headers: { 'If-Match': `"${editedObjective.data.revision}"`, 'Idempotency-Key': randomUUID() },
  });
  console.log('TypeScript objective lifecycle and real general-worker evaluation passed.');
  // Each SDK is an independent caller with its own normal production rate-limit budget.
  const pythonToken = `ok_test_${randomBytes(32).toString('base64url')}`;
  const pythonKey = await prisma.apiKey.create({
    data: {
      name: 'Ephemeral Python live SDK certification',
      userId: user.id,
      prefix: pythonToken.slice(0, 12),
      tokenHash: createHmac('sha256', secret)
        .update(`opsknight:api-key:v2:${pythonToken}`)
        .digest('hex'),
      scopes: key.scopes,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  pythonKeyId = pythonKey.id;
  const python = spawnSync(
    process.env.DOCKER_BIN ?? 'docker',
    [
      'run',
      '--rm',
      '-i',
      ...(process.platform === 'linux' ? ['--add-host=host.docker.internal:host-gateway'] : []),
      '-v',
      `${process.cwd()}:/work:ro`,
      '-w',
      '/work',
      'python:3.12-alpine',
      'python',
      'tests/sdk/live-workflow.py',
    ],
    {
      input: JSON.stringify({
        baseUrl: `http://host.docker.internal:${port}/api/v2`,
        token: pythonToken,
        typescriptRunbookId: created.data.id,
        approvalExecutionId: pythonApproveSource.id,
        rejectionExecutionId: pythonRejectSource.id,
        rerunSourceId: rerunSource.id,
        automationServiceId: automationService.id,
        runbookRuleServiceId: ruleService.id,
        runbookRuleAgentId: ruleAgent.id,
        statusPageId: statusPage.id,
        statusSubscriberId: pySubscriber.id,
      }),
      encoding: 'utf8',
      timeout: 90_000,
    }
  );
  if (python.stdout) process.stdout.write(python.stdout);
  if (python.status !== 0)
    throw new Error(`Python live workflow failed (${python.status}): ${python.stderr}`);
  console.log('Both SDKs passed against the built OpsKnight application and PostgreSQL.');
} finally {
  try {
    await prisma.apiKey.updateMany({
      where: { id: { in: [keyId, pythonKeyId].filter(Boolean) } },
      data: { revokedAt: new Date() },
    });
  } finally {
    await Promise.all([stopProcess(worker), stopProcess(server)]);
    await prisma.$disconnect();
  }
}
