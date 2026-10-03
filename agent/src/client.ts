import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { hostname, platform } from 'node:os';
import type { AgentIdentity, ClaimedAttempt, SpoolRecord } from './types';

type JsonObject = Record<string, unknown>;

export class AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly identity: AgentIdentity
  ) {}

  private async request<T>(pathname: string, body: unknown): Promise<T | null> {
    const raw = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(24).toString('base64url');
    const payload = [
      'POST',
      new URL(pathname, this.baseUrl).pathname,
      timestamp,
      nonce,
      createHash('sha256').update(raw).digest('hex'),
    ].join('\n');
    const signature = sign(null, Buffer.from(payload), this.identity.privateKey).toString('base64');
    const response = await fetch(new URL(pathname, this.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opsknight-agent-id': this.identity.agentId,
        'x-opsknight-timestamp': timestamp,
        'x-opsknight-nonce': nonce,
        'x-opsknight-signature': signature,
      },
      body: raw,
      signal: AbortSignal.timeout(35_000),
    });
    if (response.status === 204) return null;
    const json = (await response.json()) as JsonObject;
    if (!response.ok)
      throw new Error(String(json.error ?? `Agent API returned ${response.status}.`));
    return (json.data ?? json) as T;
  }

  heartbeat(input: {
    capabilities: string[];
    policyHash: string;
    spoolDepth: number;
    activeAttemptCount: number;
    lastError: string | null;
  }) {
    return this.request('/api/runbook-agent/v1/heartbeat', {
      hostname: hostname(),
      version: process.env.npm_package_version ?? '2.0.0',
      platform: platform(),
      ...input,
    });
  }

  async claim(): Promise<ClaimedAttempt | null> {
    const result = await this.request<{ attempt: ClaimedAttempt }>(
      '/api/runbook-agent/v1/claim?waitSeconds=25',
      {}
    );
    return result?.attempt ?? null;
  }

  start(attemptId: string, leaseToken: string) {
    return this.request(`/api/runbook-agent/v1/jobs/${attemptId}/start`, { leaseToken });
  }

  renew(attemptId: string, leaseToken: string) {
    return this.request<{ cancelRequested: boolean; leaseExpiresAt: string }>(
      `/api/runbook-agent/v1/jobs/${attemptId}/heartbeat`,
      { leaseToken }
    );
  }

  submit(record: SpoolRecord) {
    return this.request(`/api/runbook-agent/v1/jobs/${record.attemptId}/result`, record);
  }

  uploadArtifact(input: JsonObject) {
    return this.request<{ id: string }>('/api/runbook-agent/v1/artifacts', input);
  }
}

export async function enrollAgent(baseUrl: string, token: string): Promise<AgentIdentity> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  const response = await fetch(new URL('/api/runbook-agent/v1/enroll', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token,
      publicKey,
      hostname: hostname(),
      version: process.env.npm_package_version ?? '2.0.0',
      platform: platform(),
    }),
  });
  const json = (await response.json()) as {
    data?: { agent: { id: string } };
    agent?: { id: string };
    error?: string;
  };
  if (!response.ok) throw new Error(json.error ?? 'Agent enrollment failed.');
  const agent = json.data?.agent ?? json.agent;
  if (!agent) throw new Error('Agent enrollment response did not include an identity.');
  return { agentId: agent.id, privateKey, publicKey };
}
