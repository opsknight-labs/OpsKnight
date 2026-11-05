export type McpConsentIdentity =
  /** A client metadata document (CIMD): the host that published it vouches for the name. */
  | { kind: 'metadata'; host: string }
  /** Dynamic registration (DCR): the name is whatever the client sent. */
  | { kind: 'self-registered' }
  /** Registered by an OpsKnight administrator. */
  | { kind: 'registered' };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Where the browser goes after the decision; loopback and app-scheme redirects stay local. */
export function consentRedirectFacts(redirectUri: string) {
  try {
    const url = new URL(redirectUri);
    return {
      host: url.host || url.protocol.replace(/:$/, ''),
      staysLocal:
        LOOPBACK_HOSTS.has(url.hostname) || (url.protocol !== 'https:' && url.protocol !== 'http:'),
    };
  } catch {
    return { host: redirectUri.slice(0, 80), staysLocal: false };
  }
}

/** Only a metadata document's host identifies an assistant; a registered name is self-chosen. */
export function consentIdentity(client: {
  metadataUrl: string | null;
  dynamicRegistration: boolean;
}): McpConsentIdentity {
  if (client.metadataUrl) {
    try {
      return { kind: 'metadata', host: new URL(client.metadataUrl).host };
    } catch {}
  }
  return client.dynamicRegistration ? { kind: 'self-registered' } : { kind: 'registered' };
}
