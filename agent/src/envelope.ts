import { createPublicKey, verify } from 'node:crypto';
import type { ClaimedAttempt } from './types';

export function parseTrustedSigningKeys(
  multiple: string | undefined,
  single: string | undefined
): string | Record<string, string> {
  const value: unknown = multiple ? JSON.parse(multiple) : single?.trim();
  const entries =
    typeof value === 'string'
      ? [['default', value]]
      : value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value)
        : [];
  if (!entries.length || entries.length > 8)
    throw new Error('Pin one to eight execution signing identities.');
  for (const [id, pin] of entries) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || typeof pin !== 'string' || pin.length > 200)
      throw new Error('Invalid execution signing pin.');
    const key = createPublicKey({ key: Buffer.from(pin, 'base64'), type: 'spki', format: 'der' });
    if (key.asymmetricKeyType !== 'ed25519')
      throw new Error('Execution signing pin must be Ed25519.');
  }
  return value as string | Record<string, string>;
}

function selectTrustedKey(keys: string | Record<string, string>, keyId: unknown): string {
  if (typeof keys === 'string') return keys;
  // Only legacy envelopes without an ID use the explicitly pinned bootstrap identity.
  // An unknown or altered ID never falls back to another trusted key.
  const found = Object.entries(keys).find(
    ([id]) => id === (keyId === undefined ? 'default' : keyId)
  )?.[1];
  if (!found) throw new Error('Execution signing identity is not trusted.');
  return found;
}

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
  > & { signingKeyId?: string },
>(attempt: T, publicKey: string | Record<string, string>, agentId: string) {
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
    key: Buffer.from(selectTrustedKey(publicKey, attempt.signingKeyId), 'base64'),
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
  publicKey: string | Record<string, string>,
  agentId: string,
  attemptId: string,
  leaseTokenHash: string
) {
  const { signature, ...payload } = value;
  const key = createPublicKey({
    key: Buffer.from(selectTrustedKey(publicKey, value.signingKeyId), 'base64'),
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
