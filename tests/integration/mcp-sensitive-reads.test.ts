import { randomUUID } from 'node:crypto';
import { describeSensitiveReads, setupMcpReadDatabase } from '../helpers/mcp-read-scenarios';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestTeam,
  testPrisma as db,
} from '../helpers/test-db';

setupMcpReadDatabase();

const unique = () => randomUUID().slice(0, 8);

async function customField() {
  return db.customField.create({
    data: { name: `Region ${unique()}`, key: `region_${unique()}`, type: 'TEXT' },
  });
}

async function incident() {
  const service = await createTestService(`Sensitive read service ${unique()}`);
  return createTestIncident(`Sensitive read incident ${unique()}`, service.id);
}

async function dashboard(owner: { id: string }) {
  return db.dashboard.create({
    data: {
      name: `Operations ${unique()}`,
      userId: owner.id,
      layout: { columns: 4, rowHeight: 120 },
      config: { timeRange: 7, refreshInterval: 60 },
      widgets: {
        create: {
          widgetType: 'metric',
          metricKey: 'totalIncidents',
          position: { x: 0, y: 0, w: 1, h: 1 },
          config: {},
        },
      },
    },
  });
}

async function incidentTemplate(owner: { id: string }) {
  return db.incidentTemplate.create({
    data: {
      name: `Template ${unique()}`,
      title: 'Database degraded',
      descriptionText: 'Reviewed template body',
      createdById: owner.id,
      isPublic: true,
    },
  });
}

async function notification(owner: { id: string }) {
  const target = await incident();
  const providerMessageId = `msg-${unique()}`;
  const row = await db.notification.create({
    data: {
      incidentId: target.id,
      userId: owner.id,
      channel: 'EMAIL',
      status: 'SENT',
      message: 'Incident triggered',
      deliveryProvider: 'fixture',
      providerMessageId,
      attempts: 1,
      sentAt: new Date(),
    },
  });
  await db.notificationDeliveryAttempt.create({
    data: {
      notificationId: row.id,
      ordinal: 1,
      outcome: 'SENT',
      provider: 'fixture',
      providerMessageId,
      finishedAt: new Date(),
      latencyMs: 12,
    },
  });
  await db.notificationProviderFeedback.create({
    data: {
      provider: 'fixture',
      providerEventId: `event-${unique()}`,
      providerMessageId,
      eventType: 'DELIVERED',
      occurredAt: new Date(),
      processedAt: new Date(),
    },
  });
  return { notification: row, incident: target };
}

describeSensitiveReads([
  {
    name: 'custom field definition',
    operationId: 'getCustomFieldDefinition',
    setup: async () => ({ path: { id: (await customField()).id } }),
  },
  {
    name: 'custom field definitions',
    operationId: 'listCustomFieldDefinitions',
    setup: async () => {
      await customField();
      return {};
    },
  },
  {
    name: 'report dashboard',
    operationId: 'getReportDashboard',
    setup: async owner => ({ path: { id: (await dashboard(owner)).id } }),
  },
  {
    name: 'report dashboard data',
    operationId: 'getReportDashboardData',
    setup: async owner => ({ path: { id: (await dashboard(owner)).id } }),
  },
  {
    name: 'report dashboard widgets',
    operationId: 'listReportDashboardWidgets',
    setup: async owner => ({ path: { id: (await dashboard(owner)).id } }),
  },
  {
    name: 'report dashboards',
    operationId: 'listReportDashboards',
    setup: async owner => {
      await dashboard(owner);
      return { query: { limit: 10 } };
    },
  },
  {
    name: 'escalation policy validation',
    operationId: 'validateEscalationPolicy',
    setup: async owner => {
      const policy = await createTestEscalationPolicy(`Sensitive policy ${unique()}`, [
        { stepOrder: 0, targetType: 'USER', targetUserId: owner.id, delayMinutes: 0 },
      ]);
      return { path: { id: policy.id } };
    },
  },
  {
    name: 'incident custom field',
    operationId: 'getIncidentCustomField',
    setup: async () => {
      const [target, field] = [await incident(), await customField()];
      await db.customFieldValue.create({
        data: { incidentId: target.id, customFieldId: field.id, value: 'eu-west-1' },
      });
      return { path: { id: target.id, fieldId: field.id } };
    },
  },
  {
    name: 'incident template',
    operationId: 'getIncidentTemplate',
    setup: async owner => ({ path: { templateId: (await incidentTemplate(owner)).id } }),
  },
  {
    name: 'incident alerts',
    operationId: 'listIncidentAlerts',
    setup: async () => {
      const target = await incident();
      await db.alert.create({
        data: {
          serviceId: target.serviceId,
          incidentId: target.id,
          dedupKey: `dedup-${unique()}`,
          payload: { summary: 'CPU high', authorization: 'Bearer hidden-alert-value' },
        },
      });
      return { path: { id: target.id }, query: { limit: 10 } };
    },
  },
  {
    name: 'incident notification attempts',
    operationId: 'listIncidentNotificationAttempts',
    setup: async owner => ({
      path: { id: (await notification(owner)).incident.id },
      query: { limit: 10 },
    }),
  },
  {
    name: 'incident templates',
    operationId: 'listIncidentTemplates',
    setup: async owner => {
      await incidentTemplate(owner);
      return { query: { limit: 10 } };
    },
  },
  {
    name: 'incident war rooms',
    operationId: 'listIncidentWarRooms',
    setup: async () => {
      const target = await incident();
      await db.incidentWarRoom.create({
        data: {
          incidentId: target.id,
          provider: 'SLACK',
          state: 'READY',
          health: 'HEALTHY',
          lastError: 'private provider credential',
        },
      });
      return { path: { id: target.id }, query: { limit: 10 } };
    },
  },
  {
    name: 'incident watchers',
    operationId: 'listIncidentWatchers',
    setup: async owner => {
      const target = await incident();
      await db.incidentWatcher.create({ data: { incidentId: target.id, userId: owner.id } });
      return { path: { id: target.id }, query: { limit: 10 } };
    },
  },
  {
    name: 'notification feedback',
    operationId: 'getNotificationFeedback',
    setup: async owner => ({ path: { id: (await notification(owner)).notification.id } }),
  },
  {
    name: 'notification attempts',
    operationId: 'listNotificationAttempts',
    setup: async owner => ({
      path: { id: (await notification(owner)).notification.id },
      query: { limit: 10 },
    }),
  },
  {
    name: 'notifications',
    operationId: 'listNotifications',
    setup: async owner => {
      await notification(owner);
      return { query: { limit: 10 } };
    },
  },
  {
    name: 'operational events',
    operationId: 'listOperationalEvents',
    setup: async () => {
      const target = await incident();
      await db.incidentEvent.create({
        data: { incidentId: target.id, message: 'Incident triggered by reviewer' },
      });
      return { query: { limit: 10 } };
    },
  },
  {
    name: 'metrics report',
    operationId: 'getMetricsReport',
    setup: async () => {
      await incident();
      return { query: { days: 7 } };
    },
  },
  {
    name: 'automation settings',
    operationId: 'getAutomationSettings',
    setup: async () => ({}),
  },
  {
    name: 'runbook settings',
    operationId: 'getRunbookSettings',
    setup: async () => ({}),
  },
  {
    name: 'workspace SLA policy',
    operationId: 'getWorkspaceSlaPolicy',
    setup: async () => ({}),
  },
  {
    name: 'team activity',
    operationId: 'listTeamActivity',
    setup: async owner => {
      const team = await createTestTeam('Sensitive activity');
      await db.teamMember.create({ data: { teamId: team.id, userId: owner.id, role: 'OWNER' } });
      await db.auditLog.create({
        data: {
          action: 'team.updated',
          entityType: 'TEAM',
          entityId: team.id,
          actorId: owner.id,
          details: { name: 'Reviewed safe name', password: 'hidden-audit-credential' },
        },
      });
      return { path: { id: team.id }, query: { limit: 10 } };
    },
  },
]);
