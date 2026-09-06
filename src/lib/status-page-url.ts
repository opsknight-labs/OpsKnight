import { getBaseUrl } from '@/lib/env-validation';

export type StatusPageDomainConfig = {
  customDomain?: string | null;
  subdomain?: string | null;
};

function normalizeHostname(value: string): string {
  return value.split(':')[0]?.trim().toLowerCase() || '';
}

function parseHostname(value?: string | null): string {
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
  return normalizeHostname(trimmed.split('/')[0] || '');
}

function resolveDomainBaseUrl(domain: string | null | undefined, fallbackProtocol: string): string {
  if (!domain) return '';
  const trimmed = domain.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return '';
    }
  }
  const host = parseHostname(trimmed);
  if (!host) return '';
  return `${fallbackProtocol}//${host}`;
}

export function getStatusPagePublicBaseUrl(
  config: StatusPageDomainConfig,
  appBaseUrl: string = getBaseUrl()
): string {
  const normalizedAppBase = appBaseUrl.replace(/\/$/, '');
  let appUrl: URL;
  try {
    appUrl = new URL(normalizedAppBase);
  } catch {
    appUrl = new URL(getBaseUrl());
  }

  const fallbackProtocol = appUrl.protocol || 'https:';
  const appHost = appUrl.host;
  const appBasePath =
    appUrl.pathname && appUrl.pathname !== '/' ? appUrl.pathname.replace(/\/$/, '') : '';
  const appOriginWithPath = appBasePath ? `${appUrl.origin}${appBasePath}` : appUrl.origin;

  const customDomainBase = resolveDomainBaseUrl(config.customDomain ?? null, fallbackProtocol);
  if (customDomainBase) return customDomainBase;

  const subdomainHost = parseHostname(config.subdomain ?? null);
  if (subdomainHost) {
    const host = subdomainHost.includes('.') ? subdomainHost : `${subdomainHost}.${appHost}`;
    return `${fallbackProtocol}//${host}`;
  }

  return appOriginWithPath;
}

export function getStatusPageLogoUrl(
  config: StatusPageDomainConfig,
  statusPageId: string,
  appBaseUrl: string = getBaseUrl()
): string {
  const baseUrl = getStatusPagePublicBaseUrl(config, appBaseUrl).replace(/\/$/, '');
  return `${baseUrl}/api/status-page/logo/${statusPageId}`;
}

export function getStatusPagePublicUrl(
  config: StatusPageDomainConfig,
  appBaseUrl: string = getBaseUrl()
): string {
  const baseUrl = getStatusPagePublicBaseUrl(config, appBaseUrl);
  const hasCustomDomain = Boolean(parseHostname(config.customDomain ?? null));
  const hasSubdomain = Boolean(parseHostname(config.subdomain ?? null));
  if (hasCustomDomain || hasSubdomain) {
    return baseUrl;
  }

  return `${baseUrl}/status`;
}

export function getStatusPageVerificationUrl(
  config: StatusPageDomainConfig,
  token: string,
  appBaseUrl: string = getBaseUrl()
): string {
  const baseUrl = getStatusPagePublicBaseUrl(config, appBaseUrl);
  return `${baseUrl}/status/verify/${token}`;
}
