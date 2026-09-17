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

export function getCandidateBaseHosts(appHost?: string | null): string[] {
  const cleanAppHost = parseHostname(appHost);
  if (!cleanAppHost) return [];

  const candidates: string[] = [cleanAppHost];

  // IP addresses, localhost, single-label hosts have no parent apex domain
  const isIpv4 =
    cleanAppHost.split('.').length === 4 &&
    cleanAppHost.split('.').every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  if (
    cleanAppHost === 'localhost' ||
    cleanAppHost.endsWith('.localhost') ||
    isIpv4 ||
    cleanAppHost.includes(':')
  ) {
    return candidates;
  }

  const parts = cleanAppHost.split('.');
  if (parts.length >= 3) {
    // Check candidate parent domains (e.g. app.opsknight.com -> opsknight.com)
    for (let i = 1; i < parts.length - 1; i++) {
      const parentHost = parts.slice(i).join('.');
      const parentParts = parentHost.split('.');

      // Reject public suffixes (e.g., if appHost was app.opsknight.co.uk, parentParts for 'co.uk' has length 2 and is a known suffix)
      const isPublicSuffix =
        parentParts.length === 2 &&
        ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'gen'].includes(parentParts[0]) &&
        parentParts[1].length === 2;

      if (!isPublicSuffix && !candidates.includes(parentHost)) {
        candidates.push(parentHost);
      }
    }
  }

  return candidates;
}

export function buildSubdomainHost(subdomain: string, appHost: string): string {
  const cleanSubdomain = parseHostname(subdomain);
  if (!cleanSubdomain) return '';
  if (cleanSubdomain.includes('.')) return cleanSubdomain;
  const baseHosts = getCandidateBaseHosts(appHost);
  if (baseHosts.length === 0) return '';
  // Prefer parent apex domain if appHost is on an app subdomain (e.g. app.opsknight.com -> status.opsknight.com)
  const preferredBase = baseHosts.length > 1 ? baseHosts[baseHosts.length - 1] : baseHosts[0];
  return `${cleanSubdomain}.${preferredBase}`;
}

export function extractSubdomainFromHost(hostname: string, appHost?: string | null): string | null {
  const cleanHost = normalizeHostname(hostname);
  if (!cleanHost || !appHost) return null;

  const baseHosts = getCandidateBaseHosts(appHost);
  for (const base of baseHosts) {
    if (cleanHost.endsWith(`.${base}`)) {
      const sub = cleanHost.slice(0, -(base.length + 1));
      if (sub) return sub;
    }
  }

  return null;
}

export function matchesStatusPageDomain(
  page: {
    customDomain?: string | null;
    subdomain?: string | null;
    isDefault?: boolean;
    slug?: string | null;
  },
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
      if (cleanSubdomain.includes('.') && cleanHost === cleanSubdomain) {
        return true;
      }
      if (
        !cleanSubdomain.includes('.') &&
        !cleanHost.includes('.') &&
        cleanHost === cleanSubdomain
      ) {
        return true;
      }
      if (appHost) {
        const baseHosts = getCandidateBaseHosts(appHost);
        for (const base of baseHosts) {
          if (cleanHost === `${cleanSubdomain}.${base}`) return true;
        }
        const extractedSub = extractSubdomainFromHost(cleanHost, appHost);
        if (extractedSub && extractedSub === cleanSubdomain) return true;
      }
    }
  }

  // Slug match under base host: e.g. status-main.opsknight.com or main.opsknight.com
  if (page.slug && appHost) {
    const cleanSlug = parseHostname(page.slug);
    if (cleanSlug) {
      const extractedSub = extractSubdomainFromHost(cleanHost, appHost);
      if (extractedSub && (extractedSub === `status-${cleanSlug}` || extractedSub === cleanSlug)) {
        return true;
      }
    }
  }

  // Default page match for well-known status subdomain: e.g. status.opsknight.com
  if (page.isDefault && appHost) {
    const extractedSub = extractSubdomainFromHost(cleanHost, appHost);
    if (extractedSub === 'status') {
      return true;
    }
  }

  return false;
}
