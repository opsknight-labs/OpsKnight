import { expect, it } from 'vitest';
import { embeddingSpaceIdentity } from '@/lib/intelligence/semantic/identity';

const provider = {
  id: 'provider-a',
  kind: 'OPENAI_COMPATIBLE' as const,
  baseUrl: 'https://embedding.example/v1',
  embeddingModel: 'embedding-1',
  options: {},
};
it('separates provider, endpoint, kind and model while exposing only an opaque digest', () => {
  const identity = embeddingSpaceIdentity(provider);
  expect(identity).toMatch(/^embedding:v1:[a-f0-9]{64}$/);
  for (const change of [
    { id: 'provider-b' },
    { baseUrl: 'https://embedding.example/other' },
    { kind: 'OPENAI' as const },
    { embeddingModel: 'embedding-2' },
  ])
    expect(embeddingSpaceIdentity({ ...provider, ...change })).not.toBe(identity);
});
it('ignores display, priority, credentials and unrelated cloud options', () => {
  const rotated = {
    ...provider,
    name: 'Renamed',
    priority: 9,
    apiKey: 'secret-rotated',
    credentials: { type: 'apiKey', apiKey: 'other-secret' },
    options: { awsRegion: 'us-east-1' },
  };
  expect(embeddingSpaceIdentity(rotated)).toBe(embeddingSpaceIdentity(provider));
});
it('includes the cloud deployment selectors used by the gateway', () => {
  const cases = [
    { kind: 'AZURE_OPENAI' as const, options: { azureApiVersion: '2024-10-21' } },
    { kind: 'BEDROCK' as const, options: { awsRegion: 'us-east-1' } },
    { kind: 'VERTEX' as const, options: { gcpProject: 'project-a' } },
    { kind: 'VERTEX' as const, options: { gcpLocation: 'us-central1' } },
  ];
  for (const change of cases) {
    expect(embeddingSpaceIdentity({ ...provider, ...change })).not.toBe(
      embeddingSpaceIdentity({ ...provider, kind: change.kind })
    );
  }
  const azure = { ...provider, kind: 'AZURE_OPENAI' as const, baseUrl: null };
  expect(
    embeddingSpaceIdentity({ ...azure, options: { azureResourceName: 'resource-a' } })
  ).not.toBe(embeddingSpaceIdentity({ ...azure, options: { azureResourceName: 'resource-b' } }));
});
it('normalizes equivalent URL hosts without collapsing distinct endpoint paths', () => {
  expect(embeddingSpaceIdentity({ ...provider, baseUrl: 'https://EMBEDDING.example:443/v1' })).toBe(
    embeddingSpaceIdentity(provider)
  );
});
