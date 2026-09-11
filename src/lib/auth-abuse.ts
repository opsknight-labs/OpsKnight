import { createHmac } from 'crypto';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { checkRateLimit } from '@/lib/rate-limit';

const EMPTY_SENTINEL = '<empty>';

/**
 * HMAC-pseudonymize attacker-controlled identifiers before storing them in the
 * distributed rate-limit table or long-lived auth audit metadata. The secret is
 * deliberately separate from the identifier so dictionary reversal is not
 * possible from a database dump alone.
 */
export async function authPrivacyDigest(scope: string, value: string | null | undefined) {
  const secret = await getNextAuthSecret();
  return createHmac('sha256', secret)
    .update(`${scope}\0${value || EMPTY_SENTINEL}`)
    .digest('hex');
}

export async function consumeAuthRateLimit(
  scope: string,
  value: string | null | undefined,
  limit: number,
  windowMs: number
) {
  const digest = await authPrivacyDigest(scope, value);
  return checkRateLimit(`auth:${scope}:${digest}`, limit, windowMs);
}
