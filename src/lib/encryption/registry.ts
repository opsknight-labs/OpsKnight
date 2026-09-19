/**
 * Authoritative registry of all database fields protected by OpsKnight's encryption keyring.
 */

import crypto from 'crypto';
import { EncryptionTargetDefinition } from './types';

export const ENCRYPTION_TARGETS: EncryptionTargetDefinition[] = [
  {
    id: 'oidc.client-secret',
    model: 'OidcConfig',
    field: 'clientSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'OIDC Client Secret',
    description: 'OAuth2/OIDC client secret used for SSO authentication',
  },
  {
    id: 'slack.bot-token',
    model: 'SlackIntegration',
    field: 'botToken',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Slack Bot Token',
    description: 'Bot user OAuth access token for Slack workspace integrations',
  },
  {
    id: 'slack.signing-secret',
    model: 'SlackIntegration',
    field: 'signingSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Slack Signing Secret',
    description: 'Verification signing secret for incoming Slack interactive requests',
  },
  {
    id: 'slack-oauth.client-secret',
    model: 'SlackOAuthConfig',
    field: 'clientSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Slack OAuth Client Secret',
    description: 'Client secret used during Slack OAuth installation handshakes',
  },
  {
    id: 'slack-oauth.signing-secret',
    model: 'SlackOAuthConfig',
    field: 'signingSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Slack OAuth Signing Secret',
    description: 'Optional signing secret for managed Slack OAuth apps',
  },
  {
    id: 'jira.api-token',
    model: 'JiraConfig',
    field: 'apiTokenEncrypted',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Jira API Token',
    description: 'Atlassian Jira API token for sync and issue linking',
  },
  {
    id: 'jira.webhook-secret',
    model: 'JiraConfig',
    field: 'webhookSecretEncrypted',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Jira Webhook Secret',
    description: 'HMAC signature secret for inbound Jira webhook events',
  },
  {
    id: 'teams.client-secret',
    model: 'MicrosoftTeamsConfig',
    field: 'clientSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Microsoft Teams Client Secret',
    description: 'Microsoft Entra client secret for Teams Bot Framework integration',
  },
  {
    id: 'integration.signature-secret',
    model: 'Integration',
    field: 'signatureSecret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Integration Signature Secret',
    description: 'Shared secret for authenticating inbound webhook integrations',
  },
  {
    id: 'webhook.secret',
    model: 'WebhookIntegration',
    field: 'secret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: true,
    label: 'Outbound Webhook Secret',
    description: 'Shared secret for signing outbound webhook payloads',
  },
  {
    id: 'status-page-webhook.secret',
    model: 'StatusPageWebhook',
    field: 'secret',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: true,
    label: 'Status Page Webhook Secret',
    description: 'Secret for signing status page webhook deliveries',
  },
  {
    id: 'notification-provider.config',
    model: 'NotificationProvider',
    field: 'config',
    storageType: 'JSON_FIELD',
    jsonKeys: [
      'authToken',
      'whatsappAuthToken',
      'secretAccessKey',
      'vapidPrivateKey',
      'apiKey',
      'password',
    ],
    plaintextLegacyAllowed: true,
    label: 'Notification Provider Credentials',
    description: 'Encrypted sensitive credentials in provider JSON configuration',
  },
  {
    id: 'notification.payload-encrypted',
    model: 'Notification',
    field: 'payloadEncrypted',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Notification Payload',
    description: 'Encrypted notification dispatch payload containing recipient contact info',
  },
  {
    id: 'notification-content.encrypted-template',
    model: 'NotificationContent',
    field: 'encryptedTemplate',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Notification Content Template',
    description: 'Encrypted notification template markup and sensitive variables',
  },
  {
    id: 'chatops-intent.encrypted-payload',
    model: 'ChatOpsIntent',
    field: 'encryptedPayload',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'ChatOps Intent Payload',
    description: 'Encrypted interactive ChatOps command arguments and payloads',
  },
  {
    id: 'privacy-export.encrypted-payload',
    model: 'PrivacyExportArtifact',
    field: 'encryptedPayload',
    storageType: 'SCALAR',
    plaintextLegacyAllowed: false,
    label: 'Privacy Export Artifact Payload',
    description: 'Encrypted base64 ZIP archive for GDPR/CCPA subject access export',
  },
  {
    id: 'user-device.web-push-token',
    model: 'UserDevice',
    field: 'token',
    storageType: 'USER_DEVICE_TOKEN',
    filter: { platform: 'web-push' },
    plaintextLegacyAllowed: true,
    label: 'Web Push Subscription Token',
    description: 'Encrypted Web Push Subscription JSON for user notification devices',
  },
];

/**
 * Computes a deterministic SHA-256 fingerprint of the current encryption targets registry.
 * This guarantees that verification runs and retirement calculations match the exact
 * registry configuration.
 */
export function computeRegistryFingerprint(
  targets: EncryptionTargetDefinition[] = ENCRYPTION_TARGETS
): string {
  const canonical = [...targets]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => ({
      id: t.id,
      model: t.model,
      field: t.field,
      storageType: t.storageType,
      plaintextLegacyAllowed: t.plaintextLegacyAllowed,
      filter: t.filter ?? null,
      jsonKeys: t.jsonKeys ? [...t.jsonKeys].sort() : null,
    }));

  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function getTargetById(id: string): EncryptionTargetDefinition | undefined {
  return ENCRYPTION_TARGETS.find(t => t.id === id);
}
