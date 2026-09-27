import { createHmac, timingSafeEqual } from 'node:crypto';

export function validateTwilioRequest(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string
): boolean {
  if (!signature || !authToken) return false;
  const sorted = Array.from(params.keys())
    .sort()
    .map(key => `${key}${params.get(key) || ''}`)
    .join('');
  const expected = createHmac('sha1', authToken).update(`${url}${sorted}`).digest('base64');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
