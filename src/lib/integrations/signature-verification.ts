/**
 * Signature Verification for Webhook Security
 *
 * Provides HMAC signature verification for all supported webhook providers.
 * Includes timestamp validation to prevent replay attacks.
 */

import crypto from 'crypto';

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Perform dummy timingSafeEqual comparison to mitigate timing attacks
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Generate HMAC signature for a payload
 */
export function generateHmacSignature(
  payload: string | Buffer,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256'
): string {
  return crypto.createHmac(algorithm, secret).update(payload).digest('hex');
}

/**
 * Generic HMAC signature verification
 */
export function verifyHmacSignature(
  payload: string | Buffer,
  signature: string,
  secret: string,
  algorithm: 'sha256' | 'sha1' = 'sha256',
  prefix: string = ''
): boolean {
  const expectedSignature = prefix + generateHmacSignature(payload, secret, algorithm);
  return safeCompare(signature, expectedSignature);
}

/**
 * Validate timestamp to prevent replay attacks
 * @param timestamp Unix timestamp in seconds/ms or ISO string
 * @param maxAgeSeconds Maximum age allowed (default: 5 minutes)
 */
export function isTimestampValid(timestamp: number | string, maxAgeSeconds: number = 300): boolean {
  let ts: number;
  if (typeof timestamp === 'number') {
    // If millisecond timestamp (e.g. > 1e11), convert to seconds
    ts = timestamp > 1e11 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  } else if (typeof timestamp === 'string') {
    const trimmed = timestamp.trim();
    // Check if numeric string
    if (/^\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      ts = num > 1e11 ? Math.floor(num / 1000) : num;
    } else {
      const parsedDate = new Date(trimmed);
      if (isNaN(parsedDate.getTime())) return false;
      ts = Math.floor(parsedDate.getTime() / 1000);
    }
  } else {
    return false;
  }

  if (isNaN(ts)) return false;

  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - ts);

  return age <= maxAgeSeconds;
}

// ============================================
// Provider-Specific Signature Verification
// ============================================

/**
 * GitHub Webhook Signature Verification
 * Header: X-Hub-Signature-256: sha256=<signature>
 */
export function verifyGitHubSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature) return false;

  // GitHub sends signature as "sha256=<hex>"
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) return false;

  const providedSig = signature.slice(expectedPrefix.length);
  const expectedSig = generateHmacSignature(payload, secret, 'sha256');

  return safeCompare(providedSig, expectedSig);
}

/**
 * GitLab Webhook Signature Verification
 * Header: X-Gitlab-Token: <token>
 */
export function verifyGitLabToken(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  return safeCompare(token, secret);
}

/**
 * Sentry Webhook Signature Verification
 * Header: Sentry-Hook-Signature: <signature>
 */
export function verifySentrySignature(
  payload: string | Buffer,
  signature: string,
  clientSecret: string
): boolean {
  if (!signature || !clientSecret) return false;

  const expectedSig = generateHmacSignature(payload, clientSecret, 'sha256');
  return safeCompare(signature, expectedSig);
}

/**
 * Datadog Webhook Signature Verification
 * Custom header validation - Datadog uses shared secret in URL or header
 */
export function verifyDatadogSignature(providedKey: string, expectedKey: string): boolean {
  if (!providedKey || !expectedKey) return false;
  return safeCompare(providedKey, expectedKey);
}

/**
 * Slack Request Signature Verification
 * Headers: X-Slack-Request-Timestamp, X-Slack-Signature
 */
export function verifySlackSignature(
  payload: string | Buffer,
  timestamp: string,
  signature: string,
  signingSecret: string
): boolean {
  if (!timestamp || !signature || !signingSecret) return false;

  // Validate timestamp (within 5 minutes)
  if (!isTimestampValid(parseInt(timestamp, 10))) {
    return false;
  }

  // Build the signature base string
  const baseString = `v0:${timestamp}:${payload}`;
  const expectedSig = 'v0=' + generateHmacSignature(baseString, signingSecret, 'sha256');

  return safeCompare(signature, expectedSig);
}

/**
 * Grafana Webhook Signature Verification
 * Header: X-Grafana-Signature: <signature>
 */
export function verifyGrafanaSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expectedSig = generateHmacSignature(payload, secret, 'sha256');
  return safeCompare(signature, expectedSig);
}

/**
 * New Relic Webhook - Uses API key validation
 * Header: X-Api-Key or Api-Key
 */
export function verifyNewRelicApiKey(providedKey: string, expectedKey: string): boolean {
  if (!providedKey || !expectedKey) return false;
  return safeCompare(providedKey, expectedKey);
}

/**
 * AWS CloudWatch/SNS Message Signature Verification
 * Note: SNS uses certificate-based verification which is more complex.
 * This provides a simplified API key check. For production, implement
 * full SNS signature verification.
 */
export function verifyCloudWatchApiKey(providedKey: string, expectedKey: string): boolean {
  if (!providedKey || !expectedKey) return false;
  return safeCompare(providedKey, expectedKey);
}

/**
 * Azure Monitor - Uses shared secret validation
 */
export function verifyAzureSecret(providedSecret: string, expectedSecret: string): boolean {
  if (!providedSecret || !expectedSecret) return false;
  return safeCompare(providedSecret, expectedSecret);
}

/**
 * Vercel - Uses HMAC-SHA1 in x-vercel-signature header
 */
export function verifyVercelSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  return verifyHmacSignature(payload, signature, secret, 'sha1');
}

/**
 * Prometheus Alertmanager - Uses basic auth or API key
 */
export function verifyPrometheusAuth(providedAuth: string, expectedAuth: string): boolean {
  if (!providedAuth || !expectedAuth) return false;
  return safeCompare(providedAuth, expectedAuth);
}

// ============================================
// Verification Result Types
// ============================================

export type SignatureVerificationResult = {
  valid: boolean;
  error?: 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'EXPIRED_TIMESTAMP' | 'MISSING_SECRET';
};

/**
 * Unified signature verification for any provider
 */
export function verifyWebhookSignature(
  provider: 'github' | 'gitlab' | 'sentry' | 'slack' | 'grafana' | 'vercel' | 'generic',
  payload: string | Buffer,
  headers: Record<string, string | null>,
  secret: string
): SignatureVerificationResult {
  if (!secret) {
    return { valid: false, error: 'MISSING_SECRET' };
  }

  switch (provider) {
    case 'github': {
      const sig = headers['x-hub-signature-256'];
      if (!sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifyGitHubSignature(payload, sig, secret) };
    }

    case 'gitlab': {
      const token = headers['x-gitlab-token'];
      if (!token) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifyGitLabToken(token, secret) };
    }

    case 'sentry': {
      const sig = headers['sentry-hook-signature'];
      if (!sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifySentrySignature(payload, sig, secret) };
    }

    case 'slack': {
      const timestamp = headers['x-slack-request-timestamp'];
      const sig = headers['x-slack-signature'];
      if (!timestamp || !sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      if (!isTimestampValid(parseInt(timestamp, 10))) {
        return { valid: false, error: 'EXPIRED_TIMESTAMP' };
      }
      return { valid: verifySlackSignature(payload, timestamp, sig, secret) };
    }

    case 'grafana': {
      const sig = headers['x-grafana-signature'];
      if (!sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifyGrafanaSignature(payload, sig, secret) };
    }

    case 'vercel': {
      const sig = headers['x-vercel-signature'];
      if (!sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifyVercelSignature(payload, sig, secret) };
    }

    case 'generic':
    default: {
      // Generic HMAC verification using x-signature header
      const sig = headers['x-signature'] || headers['x-webhook-signature'];
      if (!sig) return { valid: false, error: 'MISSING_SIGNATURE' };
      return { valid: verifyHmacSignature(payload, sig, secret) };
    }
  }
}
