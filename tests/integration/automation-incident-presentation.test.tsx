import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestIncident,
} from '../helpers/test-db';
vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: vi.fn(async () => {}),
  getUserPermissions: vi.fn(async () => ({
    capabilities: ['automation.read', 'incident.sensitive.read'],
  })),
}));
import IncidentAutomationCard from '@/components/automation/IncidentAutomationCard';

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

it('reads template-based channel records without confusing queued intent, acceptance and delivery', async () => {
  const service = await createTestService('Notification presentation');
  const incident = await createTestIncident('Presentation evidence', service.id);
  await db.incidentAutomationDecision.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      mode: 'LIVE',
      routeType: 'NO_ESCALATION',
      evaluationAt: new Date(),
      summary: { supplementalActions: [{ provider: 'SLACK' }] },
    },
  });
  const notification = await db.notification.create({
    data: {
      incidentId: incident.id,
      channel: 'SLACK',
      recipientType: 'SLACK_CHANNEL',
      recipientId: service.id,
      recipientHash: 'browser-presentation-channel',
      status: 'PENDING',
      sourceType: 'AUTOMATION',
      templateKey: 'automation-slack',
      eventType: 'automation-slack',
    },
  });
  await db.notification.create({
    data: {
      incidentId: incident.id,
      channel: 'SLACK',
      recipientType: 'SLACK_CHANNEL',
      recipientId: service.id,
      recipientHash: 'browser-presentation-channel',
      status: 'DELIVERED',
      sourceType: 'SERVICE_INCIDENT',
      templateKey: 'service-slack-resolved',
      eventType: 'service-slack-resolved',
    },
  });
  const render = async () =>
    renderToStaticMarkup((await IncidentAutomationCard({ incidentId: incident.id }))!);
  const queued = await render();
  expect(queued).toContain('Slack · 1 · Queued');
  expect(queued).not.toContain('Delivery confirmed');
  await db.notification.update({ where: { id: notification.id }, data: { status: 'SENT' } });
  const accepted = await render();
  expect(accepted).toContain('Accepted by provider');
  expect(accepted).not.toContain('Delivery confirmed');
  await db.notification.update({ where: { id: notification.id }, data: { status: 'DELIVERED' } });
  expect(await render()).toContain('Delivery confirmed');
});
