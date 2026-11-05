import { getBaseUrl } from '../lib/env-validation';

/** Escapes text for raw HTML strings (MSO/VML fragments). JSX output is escaped by React. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Per-recipient substitution tokens such as `{{unsubscribe_url}}`. Bulk status-page
 * fan-out renders one template and swaps these in at send time
 * (notification-control-plane), so they must survive URL sanitising.
 */
const PLACEHOLDER = /^\{\{[a-z0-9_]+\}\}$/;

/**
 * Returns a safe href: http(s), mailto, tel, or an exact placeholder token.
 * Anything else (javascript:, data:, relative junk) becomes '#'.
 * The value is NOT HTML-escaped: React escapes attributes; raw-HTML callers must escape.
 */
export function safeHref(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim().replace(/&amp;/g, '&');
  if (PLACEHOLDER.test(trimmed)) return trimmed;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) return trimmed;
  return '#';
}

/** True when a href would render as a real, clickable link. */
export function isLinkable(url: string | null | undefined): boolean {
  return safeHref(url) !== '#';
}

/** App origin + base path, without trailing slash. Never throws. */
export function emailBaseUrl(): string {
  try {
    return getBaseUrl().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Absolute URL to the email-optimised OpsKnight logo (87×96 transparent PNG, ~6 KB). */
export function opsKnightLogoUrl(base: string = emailBaseUrl()): string | undefined {
  if (!/^https?:\/\//i.test(base)) return undefined;
  return `${base.replace(/\/+$/, '')}/images/email/opsknight-logo@2x.png`;
}

/** Intrinsic aspect ratio of the bundled logo asset (width / height). */
export const OPSKNIGHT_LOGO_RATIO = 87 / 96;

/**
 * Resolves a status-page logo (absolute, root-relative or path-relative) against the
 * public status page URL. data: URIs are rejected: Gmail and Outlook block them.
 */
export function resolveBrandLogoUrl(
  logoUrl: string | null | undefined,
  statusPageUrl: string
): string | undefined {
  if (!logoUrl) return undefined;
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  if (logoUrl.startsWith('data:')) return undefined;
  if (!/^https?:\/\//i.test(statusPageUrl)) return undefined;
  const normalizedPath = logoUrl.startsWith('/') ? logoUrl : `/${logoUrl}`;
  try {
    const parsed = new URL(statusPageUrl);
    const basePath =
      parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    if (basePath.endsWith('/status')) {
      return `${parsed.origin}${basePath.slice(0, -'/status'.length)}${normalizedPath}`;
    }
    return `${parsed.origin}${basePath}${normalizedPath}`;
  } catch {
    return `${statusPageUrl.replace(/\/$/, '')}${normalizedPath}`;
  }
}

/** Only http(s)/mailto support links are shown to subscribers. */
export function normalizeSupportUrl(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : undefined;
}
