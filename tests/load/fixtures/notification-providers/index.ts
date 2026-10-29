import type { LoadServiceFixture } from '../services';
import type { ScaleDimensions } from '../users';

export interface LoadProviderEmulatorEndpoints {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  webhookBaseUrl: string;
  pushBaseUrl: string;
  controlBaseUrl: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
}

export const DEFAULT_EMULATOR_ENDPOINTS: LoadProviderEndpointsConfig = {
  smtpHost: process.env.LOAD_SMTP_HOST || 'host.docker.internal',
  smtpPort: Number(process.env.LOAD_SMTP_PORT || 2525),
  smtpUser: 'opsknight-load',
  smtpPassword: 'opsknight-load-smtp-secret',
  fromEmail: 'alerts@loadtest.opsknight.internal',
  webhookBaseUrl:
    process.env.LOAD_WEBHOOK_BASE_URL || 'http://host.docker.internal:8086',
  pushBaseUrl: process.env.LOAD_PUSH_BASE_URL || 'http://host.docker.internal:8086',
  controlBaseUrl: process.env.LOAD_EMULATOR_CONTROL_URL || 'http://127.0.0.1:8088',
  // Deterministic P-256 VAPID keypair generated exclusively for local load-certification
  vapidPublicKey:
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U',
  vapidPrivateKey: 'UUxI4O8-FbRouAevSmBQ6o18hgE4nSG3qwvJTfKc-ls',
};

export type LoadProviderEndpointsConfig = LoadProviderEmulatorEndpoints;

export interface LoadStatusPageFixture {
  id: string;
  name: string;
  slug: string;
  organizationName: string;
  serviceIds: string[];
  webhookId: string;
  webhookUrl: string;
  webhookSecret: string;
  subscriberCount: number;
}

export function buildStatusPageFixture(
  scale: ScaleDimensions,
  services: LoadServiceFixture[],
  endpoints: LoadProviderEmulatorEndpoints = DEFAULT_EMULATOR_ENDPOINTS
): LoadStatusPageFixture {
  return {
    id: 'lt-status-page-001',
    name: 'OpsKnight Load Certification Status',
    slug: 'load-cert-status',
    organizationName: 'OpsKnight Enterprise Certification',
    serviceIds: (services.length > 1 ? services.slice(1, 2) : services.slice(0, 1)).map(
      s => s.id
    ),
    webhookId: 'lt-status-webhook-001',
    webhookUrl: `${endpoints.webhookBaseUrl.replace(/\/$/, '')}/status-webhook/lt-status-page-001`,
    webhookSecret: 'lt_status_webhook_hmac_secret_key_001',
    subscriberCount: scale.statusPageSubscribers,
  };
}
