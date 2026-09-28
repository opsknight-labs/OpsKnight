import type { ScaleDimensions } from '../users';

export interface LoadIntegrationFixture {
  id: string;
  name: string;
  type: 'EVENTS_API_V2';
  key: string;
  serviceId: string;
  enabled: boolean;
  isContractKey: boolean;
}

export interface LoadServiceFixture {
  id: string;
  name: string;
  description: string;
  region: string;
  slaTier: 'Gold' | 'Silver' | 'Bronze';
  teamId: string;
  escalationPolicyId: string;
  webhookUrl: string;
  slackChannel: string;
  slackWebhookUrl: string;
  serviceNotificationChannels: Array<'SLACK' | 'WEBHOOK' | 'MICROSOFT_TEAMS'>;
  serviceNotifyOnTriggered: boolean;
  serviceNotifyOnAck: boolean;
  serviceNotifyOnResolved: boolean;
}

const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'] as const;
const TIERS = ['Gold', 'Silver', 'Bronze'] as const;

export function buildServiceFixtures(
  scale: ScaleDimensions,
  options: {
    webhookBaseUrl?: string;
    slackWebhookBaseUrl?: string;
  } = {}
): {
  services: LoadServiceFixture[];
  integrations: LoadIntegrationFixture[];
} {
  const webhookBase = (
    options.webhookBaseUrl || 'http://webhook.emulator.opsknight.internal:8086'
  ).replace(/\/$/, '');
  const slackWebhookBase = (
    options.slackWebhookBaseUrl || 'https://hooks.slack.com/services/T000LOAD/B000LOAD'
  ).replace(/\/$/, '');

  const services: LoadServiceFixture[] = [];
  const integrations: LoadIntegrationFixture[] = [];

  for (let i = 0; i < scale.services; i++) {
    const index = i + 1;
    const serviceId = `lt-service-${String(index).padStart(3, '0')}`;
    const teamIndex = (i % scale.teams) + 1;
    const policyIndex = (i % scale.escalationPolicies) + 1;

    services.push({
      id: serviceId,
      name: `LoadCert Service ${String(index).padStart(3, '0')}`,
      description: `Critical production microservice #${index} under load certification`,
      region: REGIONS[i % REGIONS.length],
      slaTier: TIERS[i % TIERS.length],
      teamId: `lt-team-${String(teamIndex).padStart(3, '0')}`,
      escalationPolicyId: `lt-policy-${String(policyIndex).padStart(3, '0')}`,
      webhookUrl: `${webhookBase}/webhook/${serviceId}`,
      slackChannel: `#ops-alerts-${String(teamIndex).padStart(2, '0')}`,
      slackWebhookUrl: `${slackWebhookBase}/${serviceId}`,
      serviceNotificationChannels: ['SLACK', 'WEBHOOK'],
      serviceNotifyOnTriggered: true,
      serviceNotifyOnAck: true,
      serviceNotifyOnResolved: true,
    });

    for (let k = 0; k < scale.integrationsPerService; k++) {
      const globalKeyIdx = i * scale.integrationsPerService + k + 1;
      const isContractKey = globalKeyIdx === 1;
      integrations.push({
        id: `lt-integration-${String(globalKeyIdx).padStart(4, '0')}`,
        name: isContractKey
          ? `Contract Rate-Limit Integration #0001`
          : `Capacity Integration #${String(globalKeyIdx).padStart(4, '0')}`,
        type: 'EVENTS_API_V2',
        key: isContractKey
          ? 'lt_contract_events_key_0001'
          : `lt_capacity_events_key_${String(globalKeyIdx).padStart(4, '0')}`,
        serviceId,
        enabled: true,
        isContractKey,
      });
    }
  }

  return { services, integrations };
}
