/** The shape the middleware accepts for a client-supplied x-request-id. */
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * The id the middleware validated and forwarded, else a fresh one (routes called directly, as in
 * tests). One id then appears on every log line and on the response as X-Request-Id.
 */
export function trustedMcpRequestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim();
  return supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
}
