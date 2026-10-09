import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  nonceCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    runbookAgent: { findUnique: mocks.findUnique },
    runbookAgentRequestNonce: { create: mocks.nonceCreate },
  },
}));

import {
  agentSignaturePayload,
  authenticateAgentRequest,
  canonicalRequestTarget,
  sha256,
} from '@/lib/runbooks/agent-auth';

const keys = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'pem', type: 'spki' },
});

function signedRequest(
  body: string,
  timestamp = new Date().toISOString(),
  nonce = 'nonce-1',
  url = 'https://opsknight.example.com/api/runbook-agent/v1/heartbeat?ignored=true'
) {
  const signature = sign(
    null,
    Buffer.from(
      agentSignaturePayload({
        method: 'POST',
        target: url,
        timestamp,
        nonce,
        body,
      })
    ),
    keys.privateKey
  ).toString('base64');
  return new Request(url, {
    method: 'POST',
    headers: {
      'x-opsknight-agent-id': 'agent-1',
      'x-opsknight-timestamp': timestamp,
      'x-opsknight-nonce': nonce,
      'x-opsknight-signature': signature,
    },
    body,
  });
}

describe('Runbook Agent request authentication', () => {
  beforeEach(() => {
    mocks.findUnique.mockReset().mockResolvedValue({
      id: 'agent-1',
      status: 'ONLINE',
      publicKey: keys.publicKey,
    });
    mocks.nonceCreate.mockReset().mockResolvedValue({ id: 'nonce-row' });
  });

  it('binds the signature to method, path, timestamp, nonce, and exact body', async () => {
    const body = '{"spoolDepth":0}';
    await expect(authenticateAgentRequest(signedRequest(body), body)).resolves.toMatchObject({
      id: 'agent-1',
    });
    expect(mocks.nonceCreate).toHaveBeenCalledWith({
      data: { agentId: 'agent-1', nonceHash: sha256('nonce-1') },
    });
    await expect(authenticateAgentRequest(signedRequest(body), '{"spoolDepth":1}')).rejects.toThrow(
      'signature is invalid'
    );
  });

  it('canonicalizes query parameters and resists query tampering', async () => {
    const body = '{"status":"ok"}';
    const originalUrl = 'https://opsknight.example.com/api/runbook-agent/v1/claim?mode=READ_ONLY_ONLY&waitSeconds=25';

    // Valid signed request
    const req = signedRequest(body, new Date().toISOString(), 'nonce-q1', originalUrl);
    await expect(authenticateAgentRequest(req, body)).resolves.toMatchObject({ id: 'agent-1' });

    // Parameter ordering invariance in canonical target
    expect(canonicalRequestTarget('/api/runbook-agent/v1/claim?b=2&a=1')).toBe(
      '/api/runbook-agent/v1/claim?a=1&b=2'
    );

    // Tampered query parameters invalidate signature
    const signature = sign(
      null,
      Buffer.from(
        agentSignaturePayload({
          method: 'POST',
          target: originalUrl,
          timestamp: new Date().toISOString(),
          nonce: 'nonce-tamper',
          body,
        })
      ),
      keys.privateKey
    ).toString('base64');

    const tamperedReq = new Request(
      'https://opsknight.example.com/api/runbook-agent/v1/claim?mode=READ_WRITE&waitSeconds=25',
      {
        method: 'POST',
        headers: {
          'x-opsknight-agent-id': 'agent-1',
          'x-opsknight-timestamp': new Date().toISOString(),
          'x-opsknight-nonce': 'nonce-tamper',
          'x-opsknight-signature': signature,
        },
        body,
      }
    );

    await expect(authenticateAgentRequest(tamperedReq, body)).rejects.toThrow(
      'signature is invalid'
    );
  });

  it('rejects stale timestamps before database authentication', async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await expect(authenticateAgentRequest(signedRequest('{}', stale), '{}')).rejects.toThrow(
      'outside the allowed window'
    );
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('fails closed on nonce replay and revoked identities', async () => {
    mocks.nonceCreate.mockRejectedValueOnce({ code: 'P2002' });
    await expect(authenticateAgentRequest(signedRequest('{}'), '{}')).rejects.toThrow(
      'replay detected'
    );
    mocks.findUnique.mockResolvedValueOnce({
      id: 'agent-1',
      status: 'REVOKED',
      publicKey: keys.publicKey,
    });
    await expect(
      authenticateAgentRequest(signedRequest('{}', new Date().toISOString(), 'nonce-2'), '{}')
    ).rejects.toThrow();
  });
});
