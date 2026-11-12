import type { GatewayProvider } from '../ai/settings';
import { sha256 } from '../ai/digest';

/** Cache compatibility is specific to a provider deployment, not merely its public model alias. */
export function embeddingSpaceIdentity(
  provider: Pick<GatewayProvider, 'id' | 'kind' | 'baseUrl' | 'embeddingModel' | 'options'>
): string {
  // Explicit allowlist: never serialize a provider object containing decrypted credentials.
  const deployment = {
    providerId: provider.id,
    kind: provider.kind,
    baseUrl: provider.baseUrl ? new URL(provider.baseUrl).href : null,
    model: provider.embeddingModel,
    azureResource:
      provider.kind === 'AZURE_OPENAI' && !provider.baseUrl
        ? (provider.options.azureResourceName ?? null)
        : null,
    azureApiVersion:
      provider.kind === 'AZURE_OPENAI' ? (provider.options.azureApiVersion ?? null) : null,
    awsRegion: provider.kind === 'BEDROCK' ? (provider.options.awsRegion ?? null) : null,
    gcpProject: provider.kind === 'VERTEX' ? (provider.options.gcpProject ?? null) : null,
    gcpLocation: provider.kind === 'VERTEX' ? (provider.options.gcpLocation ?? null) : null,
  };
  return `embedding:v1:${sha256(JSON.stringify(deployment))}`;
}
