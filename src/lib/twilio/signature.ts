import twilio from 'twilio';

export function validateTwilioRequest(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string
): boolean {
  if (!signature || !authToken) return false;
  const paramsObject: Record<string, string> = Object.create(null);
  for (const [key, value] of params.entries()) {
    paramsObject[key] = value;
  }
  const validate =
    twilio.validateRequest ||
    (twilio as unknown as { default?: { validateRequest: typeof twilio.validateRequest } }).default
      ?.validateRequest;
  if (typeof validate === 'function') {
    return validate(authToken, signature, url, paramsObject);
  }
  return false;
}
