import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '../../sdk/typescript/dist/client.js';

// This journey requires the deployed runbook worker. It does not seed execution/step states.
export async function certifyNativeRunbookControl(prisma, baseUrl, apiKeySecret, userId) {
  const token = `ok_test_${randomBytes(32).toString('base64url')}`;
  const credential = await prisma.apiKey.create({
    data: {
      userId,
      name: 'Kind native runbook journey',
      prefix: token.slice(0, 12),
      tokenHash: createHmac('sha256', apiKeySecret)
        .update(`opsknight:api-key:v2:${token}`)
        .digest('hex'),
      scopes: [
        'runbooks:read',
        'runbooks:write',
        'runbooks:publish',
        'runbooks:execute',
        'runbooks:approve',
      ],
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const client = new Client({ baseUrl, token, allowInsecureHttp: true });
  const retryHeaders = () => ({ 'Idempotency-Key': randomUUID() });
  const paramsFor = id => ({ id });
  const waitFor = async (id, expected) => {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const execution = (await client.call('getRunbookExecution', { params: paramsFor(id) })).data;
      if (execution.status === expected) return;
      if (['FAILED', 'TIMED_OUT', 'CANCELLED', 'SUCCEEDED'].includes(execution.status))
        throw new Error(
          `Native runbook reached ${execution.status} while waiting for ${expected}.`
        );
      await delay(1000);
    }
    throw new Error(`Native runbook worker did not reach ${expected} within 60 seconds.`);
  };
  try {
    const created = (
      await client.call('createRunbook', {
        body: {
          name: 'Kind native approval journey',
          slug: `kind-native-${randomUUID()}`,
          definition: {
            steps: [
              {
                key: 'review',
                name: 'Review native action',
                type: 'APPROVAL',
                requiresApproval: true,
                config: {},
              },
            ],
          },
          inputs: [{ key: 'note', label: 'Private input', type: 'STRING', required: true }],
        },
        headers: retryHeaders(),
      })
    ).data;
    await client.call('publishRunbookDraft', {
      params: { id: created.id, versionId: created.draftVersionId },
      body: {},
      headers: { ...retryHeaders(), 'If-Match': '"0"' },
    });
    const start = async () => {
      const body = { parameters: { note: 'opaque-native-input-should-stay-private' } };
      const preview = (
        await client.call('previewRunbookExecution', { params: paramsFor(created.id), body })
      ).data;
      const request = {
        params: paramsFor(created.id),
        body: { ...body, expectedPlanDigest: preview.digest },
        headers: retryHeaders(),
      };
      const execution = (await client.call('executeRunbook', request)).data;
      if ((await client.call('executeRunbook', request)).data.executionId !== execution.executionId)
        throw new Error('Native start retry created a duplicate execution.');
      await waitFor(execution.executionId, 'WAITING_APPROVAL');
      return execution.executionId;
    };
    const review = async id => {
      const steps = (await client.call('listRunbookExecutionSteps', { params: paramsFor(id) }))
        .data;
      if (JSON.stringify(steps).includes('opaque-native-input'))
        throw new Error('Native review exposed private inputs.');
      const step = steps.find(row => row.pendingApproval?.planDigest);
      if (!step) throw new Error('Worker did not materialize the pending approval plan.');
      return {
        params: { id, stepId: step.id },
        body: { planDigest: step.pendingApproval.planDigest },
        headers: retryHeaders(),
      };
    };
    const approvedId = await start();
    const approve = await review(approvedId);
    await client.call('approveRunbookExecutionStep', approve);
    await client.call('approveRunbookExecutionStep', approve);
    await waitFor(approvedId, 'SUCCEEDED');
    const rejectedId = await start();
    const reject = await review(rejectedId);
    reject.body.reason = 'Declined native certification action';
    await client.call('rejectRunbookExecutionStep', reject);
    await client.call('rejectRunbookExecutionStep', reject);
    await waitFor(rejectedId, 'CANCELLED');
    const preview = (
      await client.call('previewRunbookExecutionRerun', { params: paramsFor(approvedId), body: {} })
    ).data;
    const rerunRequest = {
      params: paramsFor(approvedId),
      body: {
        expectedPlanDigest: preview.digest,
        previewAuthorizationToken: preview.authorizationToken,
      },
      headers: retryHeaders(),
    };
    const rerun = (await client.call('rerunRunbookExecution', rerunRequest)).data;
    if (
      rerun.executionId === approvedId ||
      (await client.call('rerunRunbookExecution', rerunRequest)).data.executionId !==
        rerun.executionId
    )
      throw new Error('Native rerun identity/retry invariant failed.');
    await waitFor(rerun.executionId, 'WAITING_APPROVAL');
    await client.call('approveRunbookExecutionStep', await review(rerun.executionId));
    await waitFor(rerun.executionId, 'SUCCEEDED');
    for (const id of [approvedId, rejectedId, rerun.executionId]) {
      await client.call('listRunbookExecutionEvidence', { params: paramsFor(id) });
      const events = (await client.call('listRunbookExecutionEvents', { params: paramsFor(id) }))
        .data;
      const action =
        id === rejectedId ? 'runbook.execution.step.rejected' : 'runbook.execution.step.approved';
      if (events.filter(event => event.action === action).length !== 1)
        throw new Error('Native decision did not retain one canonical business event.');
    }
    console.log(
      'Kind native approval, rejection and reviewed rerun passed through the real runbook worker. External Agent certification remains separate.'
    );
  } finally {
    await prisma.apiKey.update({ where: { id: credential.id }, data: { revokedAt: new Date() } });
  }
}
