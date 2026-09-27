import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type VoiceCallbackClaims = {
  notificationId?: string;
  deliveryAttemptId?: string;
  userId?: string;
  incidentId?: string;
  escalationGeneration?: number;
  expiresAt: number;
  nonce: string;
  purpose: 'voice-ack';
};

function signingSecret(): string {
  const secret = process.env.VOICE_CALLBACK_SIGNING_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'VOICE_CALLBACK_SIGNING_SECRET or NEXTAUTH_SECRET must be at least 32 characters'
    );
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

export function createVoiceCallbackToken(
  input: Omit<VoiceCallbackClaims, 'expiresAt' | 'nonce' | 'purpose'>,
  ttlMs = 30 * 60_000
): string {
  const claims: VoiceCallbackClaims = {
    ...input,
    expiresAt: Date.now() + ttlMs,
    nonce: randomBytes(16).toString('hex'),
    purpose: 'voice-ack',
  };
  const payload = encode(JSON.stringify(claims));
  const signature = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyVoiceCallbackToken(
  token: string,
  now = Date.now()
): VoiceCallbackClaims | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as VoiceCallbackClaims;
    if (
      claims.purpose !== 'voice-ack' ||
      (!claims.deliveryAttemptId &&
        (!claims.notificationId || !claims.userId || !claims.incidentId)) ||
      (claims.escalationGeneration != null && !Number.isInteger(claims.escalationGeneration)) ||
      !claims.nonce ||
      !Number.isFinite(claims.expiresAt) ||
      claims.expiresAt <= now
    ) {
      return null;
    }
    return claims;
  } catch {
    return null;
  }
}
