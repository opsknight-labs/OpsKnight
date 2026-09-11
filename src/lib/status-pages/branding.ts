import type { PublicPagePresentation, PublicStatusBranding } from './public-contract';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const LAYOUTS = new Set(['default', 'compact', 'wide']);

/**
 * Normalize the stored branding JSON into the typed public contract shape.
 *
 * The persisted object accumulated aliases over time (`primary`/`primaryColor`,
 * `background`/`backgroundColor`, `text`/`textColor`, `logo`/`logoUrl`); the public contract
 * exposes a single canonical key for each so no consumer has to know the history. Presentation
 * toggles (layout, chrome, refresh, API/RSS links) are preserved so a republish cannot reset them.
 * Returns null when nothing brand-worthy is present.
 */
export function projectPublicBranding(value: unknown): PublicStatusBranding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const layout = str(source.layout);
  const branding: PublicStatusBranding = {
    ...((str(source.logoUrl) ?? str(source.logo))
      ? { logoUrl: str(source.logoUrl) ?? str(source.logo) }
      : {}),
    ...(str(source.faviconUrl) ? { faviconUrl: str(source.faviconUrl) } : {}),
    ...((str(source.primaryColor) ?? str(source.primary))
      ? { primaryColor: str(source.primaryColor) ?? str(source.primary) }
      : {}),
    ...((str(source.backgroundColor) ?? str(source.background))
      ? { backgroundColor: str(source.backgroundColor) ?? str(source.background) }
      : {}),
    ...((str(source.textColor) ?? str(source.text))
      ? { textColor: str(source.textColor) ?? str(source.text) }
      : {}),
    ...(str(source.fontFamily) ? { fontFamily: str(source.fontFamily) } : {}),
    ...(str(source.metaTitle) ? { metaTitle: str(source.metaTitle) } : {}),
    ...(str(source.metaDescription) ? { metaDescription: str(source.metaDescription) } : {}),
    ...(str(source.customCss) ? { customCss: str(source.customCss) } : {}),
    ...(layout && LAYOUTS.has(layout) ? { layout: layout as PublicStatusBranding['layout'] } : {}),
    ...(bool(source.showHeader) !== undefined ? { showHeader: bool(source.showHeader) } : {}),
    ...(bool(source.showFooter) !== undefined ? { showFooter: bool(source.showFooter) } : {}),
    ...(bool(source.autoRefresh) !== undefined ? { autoRefresh: bool(source.autoRefresh) } : {}),
    ...(num(source.refreshInterval) !== undefined
      ? { refreshInterval: num(source.refreshInterval) }
      : {}),
    ...(bool(source.showApiLink) !== undefined ? { showApiLink: bool(source.showApiLink) } : {}),
    ...(bool(source.showRssLink) !== undefined ? { showRssLink: bool(source.showRssLink) } : {}),
  };
  return Object.keys(branding).length > 0 ? branding : null;
}

/** Page-level presentation, copied from branding so the contract does not bury chrome in JSON. */
export function projectPublicPresentation(
  branding: PublicStatusBranding | null
): PublicPagePresentation | undefined {
  if (!branding) return undefined;
  const presentation: PublicPagePresentation = {
    ...(branding.layout ? { layout: branding.layout } : {}),
    ...(typeof branding.showHeader === 'boolean' ? { showHeader: branding.showHeader } : {}),
    ...(typeof branding.showFooter === 'boolean' ? { showFooter: branding.showFooter } : {}),
    ...(typeof branding.autoRefresh === 'boolean' ? { autoRefresh: branding.autoRefresh } : {}),
    ...(typeof branding.refreshInterval === 'number'
      ? { refreshInterval: branding.refreshInterval }
      : {}),
    ...(typeof branding.showApiLink === 'boolean' ? { showApiLink: branding.showApiLink } : {}),
    ...(typeof branding.showRssLink === 'boolean' ? { showRssLink: branding.showRssLink } : {}),
  };
  return Object.keys(presentation).length > 0 ? presentation : undefined;
}
