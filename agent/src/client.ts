import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { hostname, platform } from 'node:os';
import type { AgentIdentity, ClaimedAttempt, SpoolRecord } from './types';
import { verifyLeaseAcknowledgement } from './envelope';
import { getAgentVersion } from './version';

type JsonObject = Record<string, unknown>;

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
  get terminal() {
    return [400, 403, 404, 409, 410, 422].includes(this.status);
  }
}

export class AgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly identity: AgentIdentity,
    private readonly executionPublicKey?: string | Record<string, string>
  ) {}

  private async request<T>(pathname: string, body: unknown): Promise<T | null> {
    const raw = JSON.stringify(body);
    const timestamp = new Date().toISOString();
    const nonce = randomBytes(24).toString('base64url');
    const targetUrl = new URL(pathname, this.baseUrl);
    const sortedParams = Array.from(targetUrl.searchParams.entries()).sort(([aKey, aVal], [bKey, bVal]) => {
      const cmp = aKey.localeCompare(bKey);
      return cmp !== 0 ? cmp : aVal.localeCompare(bVal);
    });
    const canonicalTarget =
      sortedParams.length > 0
        ? `${targetUrl.pathname}?${sortedParams
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')}`
        : targetUrl.pathname;
    const payload = [
      'POST',
      canonicalTarget,
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
      throw new AgentApiError(
        String(json.error ?? `Agent API returned ${response.status}.`),
        response.status
      );
    return (json.data ?? json) as T;
  }

  heartbeat(input: {
    capabilities: string[];
    policyHash: string;
    spoolDepth: number;
    deadLetterDepth: number;
    activeAttemptCount: number;
    lastError: string | null;
    capabilityReport?: {
      name: string;
      type: string;
      configured: boolean;
      available: boolean;
      reason: string | null;
    }[];
    trustedSigningKeys?: string[];
  }) {
    return this.request('/api/runbook-agent/v1/heartbeat', {
      hostname: hostname(),
      version: getAgentVersion(),
      platform: platform(),
      ...input,
    });
  }

  async claim(options?: { readOnlyOnly?: boolean }): Promise<ClaimedAttempt | null> {
    const modeParam = options?.readOnlyOnly ? '&mode=READ_ONLY_ONLY' : '';
    const result = await this.request<{ attempt: ClaimedAttempt }>(
      `/api/runbook-agent/v1/claim?waitSeconds=25${modeParam}`,
      {}
    );
    return result?.attempt ?? null;
  }

  private async leaseRequest<T extends JsonObject>(
    pathname: string,
    attemptId: string,
    leaseToken: string,
    body: unknown = { leaseToken }
  ): Promise<T> {
    const value = await this.request<T>(pathname, body);
    if (!value || !this.executionPublicKey)
      throw new Error('Missing signed lease acknowledgement or pinned key.');
    verifyLeaseAcknowledgement(
      value,
      this.executionPublicKey,
      this.identity.agentId,
      attemptId,
      createHash('sha256').update(leaseToken).digest('hex')
    );
    return value;
  }

  start(attemptId: string, leaseToken: string) {
    return this.leaseRequest<{
      startedAt: string;
      leaseExpiresAt: string;
      alreadyStarted: boolean;
    }>(`/api/runbook-agent/v1/jobs/${attemptId}/start`, attemptId, leaseToken);
  }

  renew(attemptId: string, leaseToken: string) {
    return this.leaseRequest<{ cancelRequested: boolean; leaseExpiresAt: string }>(
      `/api/runbook-agent/v1/jobs/${attemptId}/heartbeat`,
      attemptId,
      leaseToken
    );
  }

  async releaseClaim(attemptId: string, leaseToken: string): Promise<boolean> {
    try {
      const result = await this.request<{ released: boolean }>(
        `/api/runbook-agent/v1/jobs/${attemptId}/release`,
        { leaseToken }
      );
      return result?.released ?? false;
    } catch {
      return false;
    }
  }

  async submit(record: SpoolRecord) {
    const result = await this.leaseRequest<{ accepted: boolean }>(
      `/api/runbook-agent/v1/jobs/${record.attemptId}/result`,
      record.attemptId,
      record.leaseToken,
      record
    );
    if (result.accepted !== true) throw new Error('Result was not acknowledged.');
    return result;
  }

  uploadArtifact(input: JsonObject) {
    return this.leaseRequest<{ id: string }>(
      '/api/runbook-agent/v1/artifacts',
      String(input.attemptId),
      String(input.leaseToken),
      input
    );
  }

  async checkServerClock(): Promise<{ serverTime: string; skewSeconds: number }> {
    const response = await fetch(new URL('/api/runbook-agent/v1/time', this.baseUrl), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Clock check returned HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      data?: { serverTime: string; epochMs: number };
      serverTime?: string;
      epochMs?: number;
    };
    const epochMs = json.data?.epochMs ?? json.epochMs;
    const serverTime = json.data?.serverTime ?? json.serverTime ?? new Date(epochMs || Date.now()).toISOString();
    if (!epochMs) throw new Error('Invalid clock check response');
    const localMs = Date.now();
    const skewSeconds = Math.round(Math.abs(localMs - epochMs) / 1000);
    return { serverTime, skewSeconds };
  }
}

export async function enrollAgent(baseUrl: string, token: string): Promise<AgentIdentity> {
  const parsedUrl = new URL(baseUrl);
  const isLoopback = ['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname);
  if (
    parsedUrl.protocol !== 'https:' &&
    !isLoopback &&
    !(
      (process.env.NODE_ENV === 'development' &&
        process.env.OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS === 'true') ||
      process.env.OPSKNIGHT_ALLOW_INSECURE_HTTP === 'true'
    )
  ) {
    throw new Error('Enrollment token transport requires an HTTPS control-plane URL.');
  }

  try {
    const timeRes = await fetch(new URL('/api/runbook-agent/v1/time', baseUrl), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (timeRes.ok) {
      const timeJson = (await timeRes.json()) as {
        data?: { epochMs: number };
        epochMs?: number;
      };
      const serverEpoch = timeJson.data?.epochMs ?? timeJson.epochMs;
      if (serverEpoch) {
        const skewSeconds = Math.round(Math.abs(Date.now() - serverEpoch) / 1000);
        if (skewSeconds > 60) {
          throw new Error(
            `Local clock is out of sync with OpsKnight by ${skewSeconds}s (maximum allowed: 60s). Synchronize NTP/chrony before enrolling.`
          );
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('out of sync')) {
      throw err;
    }
  }

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
      version: getAgentVersion(),
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
