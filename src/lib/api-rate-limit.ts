import { checkRateLimit } from '@/lib/rate-limit';

export async function checkApiKeyRateLimit(
  namespace: string,
  apiKeyId: string,
  limit: number = 120,
  windowMs: number = 60_000
) {
  const result = await checkRateLimit(`api:${namespace}:key:${apiKeyId}`, limit, windowMs);
  return {
    allowed: result.allowed,
    retryAfter: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
}
