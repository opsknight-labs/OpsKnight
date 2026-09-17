/**
 * Shared hostname and status route resolution helpers.
 * Free of database dependencies so it can be safely imported by edge middleware,
 * API routes, and status resolvers.
 */

export function normalizeHostname(value?: string | null): string {
  if (!value) return '';
  const candidate = value.trim().toLowerCase().replace(/\.$/, '');
  if (!candidate || candidate.length > 253 || /[^a-z0-9.:[\]-]/.test(candidate)) return '';
  try {
    return new URL(`http://${candidate}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

export function parseHostname(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return normalizeHostname(new URL(trimmed).host);
    } catch {
      return '';
    }
  }
  return normalizeHostname(trimmed);
}

export function buildSubdomainHost(subdomain: string, appHost: string): string {
  const cleanSubdomain = parseHostname(subdomain);
  if (!cleanSubdomain) return '';
  if (cleanSubdomain.includes('.')) return cleanSubdomain;
  const baseHost = normalizeHostname(appHost);
  if (!baseHost) return '';
  return `${cleanSubdomain}.${baseHost}`;
}

export function extractSubdomainFromHost(hostname: string, appHost?: string | null): string | null {
  const cleanHost = normalizeHostname(hostname);
  if (!cleanHost) return null;

  if (appHost) {
    const cleanAppHost = normalizeHostname(appHost);
    if (cleanAppHost && cleanHost.endsWith(`.${cleanAppHost}`)) {
      const sub = cleanHost.slice(0, -(cleanAppHost.length + 1));
      return sub || null;
    }
  }

  // Fallback: if hostname has multiple dot-separated parts, the first part is a potential subdomain
  if (cleanHost.includes('.')) {
    const parts = cleanHost.split('.');
    if (parts.length >= 3) {
      return parts[0] || null;
    }
  }

  return null;
}

export function matchesStatusPageDomain(
  page: { customDomain?: string | null; subdomain?: string | null },
  hostname: string,
  appHost?: string | null
): boolean {
  const cleanHost = normalizeHostname(hostname);
  if (!cleanHost) return false;

  const customHost = parseHostname(page.customDomain);
  if (customHost && cleanHost === customHost) {
    return true;
  }

  if (page.subdomain) {
    const cleanSubdomain = parseHostname(page.subdomain);
    if (cleanSubdomain) {
      if (cleanHost === cleanSubdomain) return true;
      if (appHost) {
        const fullSubHost = buildSubdomainHost(cleanSubdomain, appHost);
        if (fullSubHost && cleanHost === fullSubHost) return true;
      }
      const extractedSub = extractSubdomainFromHost(cleanHost, appHost);
      if (extractedSub && extractedSub === cleanSubdomain) return true;
    }
  }

  return false;
}
