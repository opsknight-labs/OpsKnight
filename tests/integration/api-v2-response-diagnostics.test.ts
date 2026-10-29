import { beforeEach, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as listExecutions } from '@/app/api/v2/runbooks/executions/route';
import { GET as listAttempts } from '@/app/api/v2/notifications/[id]/attempts/route';
import { GET as getFeedback } from '@/app/api/v2/notifications/[id]/feedback/route';
import { GET as responseActivity } from '@/app/api/v2/incidents/[id]/response-activity/route';
import { GET as incidentAlerts } from '@/app/api/v2/incidents/[id]/alerts/route';
import { GET as incidentExecutions } from '@/app/api/v2/incidents/[id]/runbook-executions/route';
import { GET as incidentAttempts } from '@/app/api/v2/incidents/[id]/notification-attempts/route';
import { GET as availableActions } from '@/app/api/v2/incidents/[id]/available-actions/route';
import { GET as relatedIncidents } from '@/app/api/v2/incidents/[id]/related-incidents/route';
import { GET as operationalEvents } from '@/app/api/v2/operational-events/route';
import { GET as serviceChangeEvents } from '@/app/api/v2/services/[id]/change-events/route';
import { POST as previewEscalationPolicy } from '@/app/api/v2/escalation-policies/[id]/preview/route';
import { GET as serviceHealthSummary } from '@/app/api/v2/services/[id]/health-summary/route';
import { createRunbook } from '@/lib/runbooks/versioning';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

function invokeItem(
  handler: (req: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>,
  token: string,
  path: string,
  id: string
) {
  return handler(new NextRequest(`http://localhost/api/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test database required');
  }
  await resetDatabase();
});

it('lists only metadata for executions attached to an accessible incident', async () => {
  const reader = await createV2Credential(['runbooks:read', 'incidents:read']);
  const service = await createTestService('Diagnostic service');
  const incident = await createTestIncident('Diagnostic incident', service.id);
  const other = await createTestIncident('Other incident', service.id);
  const runbook = await createRunbook({ name: 'Diagnostic runbook', slug: 'diagnostic-runbook', description: '' }, reader.user.id);
  const createExecution = (incidentId: string, createdAt: Date) => testPrisma.runbookExecution.create({
    data: {
      runbookId: runbook.id, runbookVersionId: runbook.draftVersion.id, incidentId,
      deadlineAt: new Date(Date.now() + 60_000), definitionChecksum: 'diagnostic-checksum',
      inputValues: { secret: 'never-disclose' }, executionPlan: { internal: 'never-disclose' },
      createdAt,
    },
  });
  const wanted = await createExecution(incident.id, new Date('2026-10-20T10:00:00Z'));
  const newer = await createExecution(incident.id, new Date('2026-10-20T11:00:00Z'));
  await createExecution(other.id, new Date('2026-10-20T12:00:00Z'));
  const path = `/runbooks/executions?incidentId=${incident.id}`;
  const response = await invokeV2(listExecutions, reader.token, 'GET', path, {});
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toHaveLength(2);
  expect(body.data.map((row: { id: string }) => row.id)).toEqual([newer.id, wanted.id]);
  expect(JSON.stringify(body)).not.toContain('never-disclose');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const firstPage = await invokeV2(listExecutions, reader.token, 'GET', `${path}&limit=1`, {});
  const pageOne = await firstPage.json();
  expect(pageOne.data.map((row: { id: string }) => row.id)).toEqual([newer.id]);
  const secondPage = await invokeV2(listExecutions, reader.token, 'GET', `${path}&limit=1&cursor=${encodeURIComponent(pageOne.pagination.nextCursor)}`, {});
  expect((await secondPage.json()).data.map((row: { id: string }) => row.id)).toEqual([wanted.id]);
  const incidentPath = `/incidents/${incident.id}/runbook-executions`;
  const scopedPage = await invokeItem(incidentExecutions, reader.token, `${incidentPath}?limit=1`, incident.id);
  expect(scopedPage.status).toBe(200);
  const scopedBody = await scopedPage.json();
  expect(scopedBody.data.map((row: { id: string }) => row.id)).toEqual([newer.id]);
  const scopedNext = await invokeItem(incidentExecutions, reader.token, `${incidentPath}?limit=1&cursor=${encodeURIComponent(scopedBody.pagination.nextCursor)}`, incident.id);
  expect((await scopedNext.json()).data.map((row: { id: string }) => row.id)).toEqual([wanted.id]);
  const noIncidentScope = await createV2Credential(['runbooks:read']);
  expect((await invokeV2(listExecutions, noIncidentScope.token, 'GET', path, {})).status).toBe(403);
  const missing = await invokeV2(listExecutions, reader.token, 'GET', '/runbooks/executions?incidentId=missing', {});
  expect(missing.status).toBe(404);
  expect((await invokeItem(incidentExecutions, noIncidentScope.token, incidentPath, incident.id)).status).toBe(403);
});

it('returns bounded delivery attempts without provider IDs or raw errors', async () => {
  const reader = await createV2Credential(['notifications:read']);
  const notification = await testPrisma.notification.create({ data: {
    channel: 'EMAIL', status: 'FAILED', userId: reader.user.id,
    deliveryProvider: 'smtp', providerMessageId: 'private-provider-id',
  } });
  await testPrisma.notificationDeliveryAttempt.create({ data: {
    notificationId: notification.id, ordinal: 1, outcome: 'FAILED', provider: 'smtp',
    providerMessageId: 'private-provider-id', errorCode: 'TEMPORARY_FAILURE',
    errorMessage: 'private address and token',
  } });
  const path = `/notifications/${notification.id}/attempts`;
  const response = await invokeItem(listAttempts, reader.token, path, notification.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0]).toMatchObject({ ordinal: 1, outcome: 'FAILED', errorCode: 'TEMPORARY_FAILURE' });
  expect(JSON.stringify(body)).not.toMatch(/private-provider-id|private address and token/);
  await testPrisma.notificationDeliveryAttempt.create({ data: {
    notificationId: notification.id, ordinal: 2, outcome: 'RETRYING', provider: 'smtp',
    startedAt: new Date(Date.now() + 60_000),
  } });
  const pageOneResponse = await invokeItem(listAttempts, reader.token, `${path}?limit=1`, notification.id);
  const pageOne = await pageOneResponse.json();
  expect(pageOne.data[0].ordinal).toBe(2);
  const pageTwoResponse = await invokeItem(listAttempts, reader.token, `${path}?limit=1&cursor=${encodeURIComponent(pageOne.pagination.nextCursor)}`, notification.id);
  expect((await pageTwoResponse.json()).data[0].ordinal).toBe(1);
  await testPrisma.notificationProviderFeedback.create({ data: {
    provider: 'smtp', providerEventId: 'private-event-id',
    providerMessageId: 'private-provider-id', eventType: 'BOUNCED',
    occurredAt: new Date(),
  } });
  const feedback = await invokeItem(getFeedback, reader.token, `/notifications/${notification.id}/feedback`, notification.id);
  expect(feedback.status).toBe(200);
  const feedbackBody = await feedback.json();
  expect(feedbackBody.data.events).toMatchObject([{ eventType: 'BOUNCED' }]);
  expect(JSON.stringify(feedbackBody)).not.toMatch(/private-provider-id|private-event-id/);
  const other = await createV2Credential(['incidents:read']);
  expect((await invokeItem(listAttempts, other.token, path, notification.id)).status).toBe(403);
  expect((await invokeItem(getFeedback, other.token, `/notifications/${notification.id}/feedback`, notification.id)).status).toBe(403);
});

it('joins bounded response metadata without leaking alert payload or delivery content', async () => {
  const reader = await createV2Credential(['incidents:read', 'notifications:read', 'runbooks:read']);
  const service = await createTestService('Response activity service');
  const incident = await createTestIncident('Response activity incident', service.id);
  await testPrisma.alert.create({ data: {
    serviceId: service.id, incidentId: incident.id, status: 'TRIGGERED',
    dedupKey: 'stable-correlation', payload: { token: 'secret-alert-payload' },
  } });
  await testPrisma.incidentEvent.create({ data: {
    incidentId: incident.id, message: 'secret-untrusted-event-text',
  } });
  const notification = await testPrisma.notification.create({ data: {
    incidentId: incident.id, userId: reader.user.id, channel: 'EMAIL',
    message: 'secret-delivery-content',
  } });
  const runbook = await createRunbook({ name: 'Activity runbook', slug: 'activity-runbook', description: '' }, reader.user.id);
  const execution = await testPrisma.runbookExecution.create({ data: {
    runbookId: runbook.id, runbookVersionId: runbook.draftVersion.id,
    incidentId: incident.id, deadlineAt: new Date(Date.now() + 60_000),
    definitionChecksum: 'activity-checksum', inputValues: { secret: 'secret-execution-input' },
  } });
  const path = `/incidents/${incident.id}/response-activity`;
  const response = await invokeItem(responseActivity, reader.token, path, incident.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    incident: { id: incident.id },
    alerts: [{ correlationHash: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    notifications: [{ id: notification.id }],
    executions: [{ id: execution.id }],
    truncated: { alerts: false, events: false, notifications: false, executions: false },
  });
  expect(JSON.stringify(body)).not.toMatch(/stable-correlation|secret-alert-payload|secret-untrusted-event-text|secret-delivery-content|secret-execution-input/);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const alerts = await invokeItem(incidentAlerts, reader.token, `/incidents/${incident.id}/alerts`, incident.id);
  expect(alerts.status).toBe(200);
  const alertBody = await alerts.json();
  expect(alertBody.data).toMatchObject([{ correlationHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
  expect(JSON.stringify(alertBody)).not.toMatch(/stable-correlation|secret-alert-payload/);
  await testPrisma.notificationDeliveryAttempt.create({ data: {
    notificationId: notification.id, ordinal: 1, outcome: 'FAILED',
    providerMessageId: 'private-incident-message', errorCode: 'private-exception-token',
    errorMessage: 'private-incident-error',
  } });
  const attempts = await invokeItem(incidentAttempts, reader.token, `/incidents/${incident.id}/notification-attempts`, incident.id);
  expect(attempts.status).toBe(200);
  const attemptBody = await attempts.json();
  expect(attemptBody.data).toMatchObject([{ notificationId: notification.id, errorCode: null, notification: { channel: 'EMAIL' } }]);
  expect(JSON.stringify(attemptBody)).not.toMatch(/private-incident-message|private-incident-error|private-exception-token/);
  const missingScope = await createV2Credential(['incidents:read', 'runbooks:read']);
  expect((await invokeItem(responseActivity, missingScope.token, path, incident.id)).status).toBe(403);
  expect((await invokeItem(incidentAttempts, missingScope.token, `/incidents/${incident.id}/notification-attempts`, incident.id)).status).toBe(403);
  const actionResponse = await invokeItem(availableActions, reader.token, `/incidents/${incident.id}/available-actions`, incident.id);
  expect(actionResponse.status).toBe(200);
  const actionBody = await actionResponse.json();
  expect(actionBody.data.advisory).toBe(true);
  expect(actionBody.data.actions.find((action: { operationId: string }) => action.operationId === 'acknowledgeIncident')).toMatchObject({ allowed: false, stateEligible: true });
  expect(actionBody.data.runbookExecution).toMatchObject({ requiresRunbookSelection: true, allowedToAttemptPreview: false });
  const operator = await createV2Credential(['incidents:read', 'incidents:write', 'runbooks:execute']);
  const operatorActions = await invokeItem(availableActions, operator.token, `/incidents/${incident.id}/available-actions`, incident.id);
  expect((await operatorActions.json()).data.actions.find((action: { operationId: string }) => action.operationId === 'acknowledgeIncident').allowed).toBe(true);
});

it('finds related accessible incidents through recorded alert correlation without exposing keys', async () => {
  const reader = await createV2Credential(['incidents:read']);
  const service = await createTestService('Related service');
  const source = await createTestIncident('Source incident', service.id);
  const related = await createTestIncident('Correlated incident', service.id);
  const unrelated = await createTestIncident('Unrelated incident', service.id);
  for (const [incidentId, dedupKey] of [[source.id, 'shared-secret-key'], [related.id, 'shared-secret-key'], [unrelated.id, 'different-key']]) {
    await testPrisma.alert.create({ data: {
      serviceId: service.id, incidentId, status: 'TRIGGERED', dedupKey,
      payload: { private: 'hidden-alert-payload' },
    } });
  }
  const path = `/incidents/${source.id}/related-incidents`;
  const response = await invokeItem(relatedIncidents, reader.token, path, source.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data.related.map((entry: { incident: { id: string } }) => entry.incident.id)).toEqual([related.id]);
  expect(body.data.related[0].correlationHashes).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/)]);
  expect(JSON.stringify(body)).not.toMatch(/shared-secret-key|hidden-alert-payload|different-key/);
  expect((await invokeItem(relatedIncidents, reader.token, `/incidents/missing/related-incidents`, 'missing')).status).toBe(404);
});

it('paginates operational events while excluding untrusted messages', async () => {
  const reader = await createV2Credential(['incidents:read']);
  const service = await createTestService('Operational feed service');
  const incident = await createTestIncident('Operational feed incident', service.id);
  const older = await testPrisma.incidentEvent.create({ data: {
    incidentId: incident.id, message: 'private-event-content',
    createdAt: new Date('2026-10-20T10:00:00Z'),
  } });
  const newer = await testPrisma.incidentEvent.create({ data: {
    incidentId: incident.id, message: 'private-event-content',
    createdAt: new Date('2026-10-20T11:00:00Z'),
  } });
  const first = await invokeV2(operationalEvents, reader.token, 'GET', '/operational-events?limit=1', {});
  expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.data.map((event: { id: string }) => event.id)).toEqual([newer.id]);
  expect(JSON.stringify(body)).not.toContain('private-event-content');
  const next = await invokeV2(operationalEvents, reader.token, 'GET', `/operational-events?limit=1&cursor=${encodeURIComponent(body.pagination.nextCursor)}`, {});
  expect((await next.json()).data.map((event: { id: string }) => event.id)).toEqual([older.id]);
  const noScope = await createV2Credential(['services:read']);
  expect((await invokeV2(operationalEvents, noScope.token, 'GET', '/operational-events', {})).status).toBe(403);
});

it('returns only service audit metadata to credentials with audit access', async () => {
  const reader = await createV2Credential(['services:read', 'audit:read']);
  const service = await createTestService('Change feed service');
  await testPrisma.auditLog.create({ data: {
    action: 'service.updated', entityType: 'SERVICE', entityId: service.id,
    details: { secret: 'private-change-details' },
  } });
  const path = `/services/${service.id}/change-events`;
  const response = await invokeItem(serviceChangeEvents, reader.token, path, service.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject([{ action: 'service.updated', source: 'AUDIT_LOG' }]);
  expect(JSON.stringify(body)).not.toContain('private-change-details');
  const noAudit = await createV2Credential(['services:read']);
  expect((await invokeItem(serviceChangeEvents, noAudit.token, path, service.id)).status).toBe(403);
});

it('previews escalation recipients without creating notifications', async () => {
  const reader = await createV2Credential([
    'escalation-policies:read', 'incidents:read', 'users:read', 'schedules:read',
  ]);
  const service = await createTestService('Escalation preview service');
  const incident = await createTestIncident('Escalation preview incident', service.id);
  const policy = await testPrisma.escalationPolicy.create({ data: {
    name: 'Preview policy', steps: { create: [{
      stepOrder: 0, delayMinutes: 5, targetType: 'USER', targetUserId: reader.user.id,
    }] },
  } });
  const before = await testPrisma.notification.count();
  const path = `/escalation-policies/${policy.id}/preview`;
  const response = await previewEscalationPolicy(new NextRequest(`http://localhost/api/v2${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${reader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: incident.id }),
  }), { params: Promise.resolve({ id: policy.id }) });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({ advisory: true, steps: [{
    applicable: true, outcome: 'RESOLVED', recipientUserIds: [reader.user.id], delayMinutes: 5,
  }] });
  expect(await testPrisma.notification.count()).toBe(before);
  const noUsersScope = await createV2Credential(['escalation-policies:read', 'incidents:read', 'schedules:read']);
  const denied = await previewEscalationPolicy(new NextRequest(`http://localhost/api/v2${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${noUsersScope.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ incidentId: incident.id }),
  }), { params: Promise.resolve({ id: policy.id }) });
  expect(denied.status).toBe(403);
});

it('combines visible service health evidence with bounded on-call coverage', async () => {
  const reader = await createV2Credential([
    'services:read', 'incidents:read', 'notifications:read', 'service-objectives:read',
    'escalation-policies:read', 'schedules:read',
  ]);
  const service = await createTestService('Health summary service');
  const incident = await createTestIncident('Health summary incident', service.id);
  await testPrisma.notification.create({ data: {
    incidentId: incident.id, userId: reader.user.id, channel: 'EMAIL', status: 'FAILED',
    errorMsg: 'private-notification-failure',
  } });
  const path = `/services/${service.id}/health-summary`;
  const response = await invokeItem(serviceHealthSummary, reader.token, path, service.id);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    service: { id: service.id }, activeIncidentCount: 1,
    recentIncidents: [{ id: incident.id }],
    last24Hours: { failedNotificationCount: 1 },
    onCallCoverage: { state: 'NO_FIRST_STEP', eligibleResponderCount: null },
  });
  expect(JSON.stringify(body)).not.toContain('private-notification-failure');
  const noNotificationScope = await createV2Credential([
    'services:read', 'incidents:read', 'service-objectives:read', 'escalation-policies:read', 'schedules:read',
  ]);
  expect((await invokeItem(serviceHealthSummary, noNotificationScope.token, path, service.id)).status).toBe(403);
});

it('does not reveal cross-team incidents through correlation or the operational feed', async () => {
  const reader = await createV2Credential(['incidents:read'], 'USER');
  const team = await testPrisma.team.create({ data: {
    name: 'Visible diagnostic team', members: { create: { userId: reader.user.id } },
  } });
  const otherTeam = await testPrisma.team.create({ data: { name: 'Hidden diagnostic team' } });
  const visibleService = await createTestService('Visible diagnostic service', team.id);
  const hiddenService = await createTestService('Hidden diagnostic service', otherTeam.id);
  const source = await createTestIncident('Visible source', visibleService.id);
  const hidden = await createTestIncident('Hidden match', hiddenService.id);
  for (const [incidentId, serviceId] of [[source.id, visibleService.id], [hidden.id, hiddenService.id]]) {
    await testPrisma.alert.create({ data: {
      incidentId, serviceId, dedupKey: 'shared-private-correlation', payload: {},
    } });
    await testPrisma.incidentEvent.create({ data: {
      incidentId, message: 'private-event-message',
    } });
  }
  const related = await invokeItem(relatedIncidents, reader.token, `/incidents/${source.id}/related-incidents`, source.id);
  expect(related.status).toBe(200);
  expect((await related.json()).data.related).toEqual([]);
  const feed = await invokeV2(operationalEvents, reader.token, 'GET', '/operational-events', {});
  expect(feed.status).toBe(200);
  const feedBody = await feed.json();
  expect(feedBody.data.map((event: { incidentId: string }) => event.incidentId)).toEqual([source.id]);
  expect(JSON.stringify(feedBody)).not.toContain(hidden.id);
});
