export type McpConsentIdentity =
  /**
   * A client metadata document (CIMD): the host that published it chose the name. `trusted` only
   * when an administrator listed that host; otherwise any public HTTPS site could have published it.
   */
  | { kind: 'metadata'; host: string; trusted: boolean }
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
      // Without the query: it can carry long, meaningless state.
      address: `${url.protocol}//${url.host}${url.pathname}`.slice(0, 200),
      staysLocal:
        LOOPBACK_HOSTS.has(url.hostname) || (url.protocol !== 'https:' && url.protocol !== 'http:'),
    };
  } catch {
    return {
      host: redirectUri.slice(0, 80),
      address: redirectUri.slice(0, 200),
      staysLocal: false,
    };
  }
}

/**
 * Only a metadata document's host identifies an assistant; a registered name is self-chosen. The
 * host is trusted only when it is on the administrator's list (compared by hostname, as
 * isCimdHostAllowed does).
 */
export function consentIdentity(
  client: { metadataUrl: string | null; dynamicRegistration: boolean },
  policy: { cimdAllowedHosts: readonly string[] } | null = null
): McpConsentIdentity {
  if (client.metadataUrl) {
    try {
      const host = new URL(client.metadataUrl).hostname.toLowerCase();
      const allowed = policy?.cimdAllowedHosts ?? [];
      return { kind: 'metadata', host, trusted: allowed.length > 0 && allowed.includes(host) };
    } catch {}
  }
  return client.dynamicRegistration ? { kind: 'self-registered' } : { kind: 'registered' };
}

/**
 * Whether to warn before the browser returns to a web address the assistant's own identity does
 * not vouch for: any web redirect of a self-registered assistant, or a metadata-document
 * assistant whose redirect host is neither its publisher's host nor a subdomain of it. Loopback
 * and app-scheme redirects stay on the person's device and are not warned about.
 */
export function consentRedirectWarning(identity: McpConsentIdentity, redirectUri: string) {
  const facts = consentRedirectFacts(redirectUri);
  if (facts.staysLocal) return false;
  if (identity.kind === 'self-registered') return true;
  if (identity.kind !== 'metadata') return false;
  let redirectHost: string;
  try {
    redirectHost = new URL(redirectUri).hostname.toLowerCase();
  } catch {
    return true;
  }
  return !(redirectHost === identity.host || redirectHost.endsWith(`.${identity.host}`));
}
