import { createPublicKey, verify } from 'node:crypto';
import type { ClaimedAttempt } from './types';

export function canonicalEnvelope(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === 'object')
      return Object.fromEntries(
        Object.entries(entry)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, value]) => [key, normalize(value)])
      );
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export function verifyExecutionEnvelope<
  T extends Pick<
    ClaimedAttempt,
    'signature' | 'signingAgentId' | 'executionDeadlineAt' | 'leaseExpiresAt'
  >,
>(attempt: T, publicKey: string, agentId: string) {
  const { signature, ...payload } = attempt;
  if (
    !signature ||
    attempt.signingAgentId !== agentId ||
    !Number.isFinite(Date.parse(attempt.executionDeadlineAt ?? '')) ||
    Date.parse(attempt.executionDeadlineAt!) <= Date.now() ||
    !Number.isFinite(Date.parse(attempt.leaseExpiresAt)) ||
    Date.parse(attempt.leaseExpiresAt) <= Date.now()
  ) {
    throw new Error('Execution envelope is missing, expired, or addressed to another Agent.');
  }
  const key = createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    type: 'spki',
    format: 'der',
  });
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(null, Buffer.from(canonicalEnvelope(payload)), key, Buffer.from(signature, 'base64'))
  ) {
    throw new Error('Execution envelope signature is invalid.');
  }
}

export function verifyLeaseAcknowledgement(
  value: Record<string, unknown>,
  publicKey: string,
  agentId: string,
  attemptId: string,
  leaseTokenHash: string
) {
  const { signature, ...payload } = value;
  const key = createPublicKey({
    key: Buffer.from(publicKey, 'base64'),
    type: 'spki',
    format: 'der',
  });
  if (
    typeof signature !== 'string' ||
    value.signingAgentId !== agentId ||
    value.attemptId !== attemptId ||
    value.leaseTokenHash !== leaseTokenHash ||
    key.asymmetricKeyType !== 'ed25519' ||
    !verify(null, Buffer.from(canonicalEnvelope(payload)), key, Buffer.from(signature, 'base64'))
  )
    throw new Error('Invalid signed lease acknowledgement.');
}
