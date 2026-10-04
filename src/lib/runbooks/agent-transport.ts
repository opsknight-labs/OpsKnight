import 'server-only';

/** Only trust forwarded protocol when the operator explicitly trusts an overwriting edge. */
export function hasConfidentialAgentTransport(request: Request): boolean {
  const forwardedProtocol = request.headers.get('x-forwarded-proto');
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const protocol = forwardedProtocol?.trim().toLowerCase();
    // Reject chains/ambiguous values: the trusted ingress must overwrite this header.
    if (protocol) return protocol === 'https';
  }
  // Framework adapters may derive request.url from forwarded headers. Never treat
  // such a URL as proof of TLS when the forwarding edge has not been trusted.
  if (forwardedProtocol !== null) return false;
  return new URL(request.url).protocol === 'https:';
}
