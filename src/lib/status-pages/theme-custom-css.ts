import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
} from '@/lib/status-pages/theme-contract';

/**
 * Older gallery CSS was stored wholesale in branding.customCss. Some persisted payloads can lose
 * the leading `/* Template: ... *\/` marker during migrations/edits while retaining the distinctive
 * template structure. Detect that structure conservatively so curated themes do not inherit stale
 * `!important` light-card rules.
 *
 * Require several independent fingerprints rather than matching a single service-card selector;
 * this keeps ordinary customer-authored Advanced CSS working as the final override layer.
 */
function looksLikeLegacyStatusPageTemplateCss(value: string): boolean {
  const importantCount = value.match(/!important\b/gi)?.length ?? 0;
  if (importantCount < 3) return false;

  const hasServiceCard = value.includes('.status-service-card');
  const hasContainer = value.includes('.status-page-container');
  const hasLegacyChrome =
    value.includes('.status-page-header') ||
    value.includes('#incidents .status-incident-card') ||
    value.includes('form button[type="submit"]') ||
    value.includes("form button[type='submit']");

  return hasServiceCard && hasContainer && hasLegacyChrome;
}

/**
 * Resolve the Advanced CSS that is allowed to reach the public renderer.
 *
 * Old gallery templates were stored wholesale in `branding.customCss` and commonly contain
 * `!important` light-surface rules such as white service cards. Once a curated built-in theme is
 * selected, those legacy template rules are stale implementation detail and must not compete with
 * the theme compiler. Genuine customer-authored Advanced CSS remains the final override layer.
 *
 * Default deliberately preserves legacy template CSS for backwards compatibility until the user
 * explicitly switches to a curated theme.
 */
export function resolveStatusPageCustomCss(themeId: unknown, value: unknown): string {
  if (typeof value !== 'string') return '';

  const selectedTheme = resolveStatusPageTheme(themeId);
  if (
    selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID &&
    (isLegacyStatusPageTemplateCss(value) || looksLikeLegacyStatusPageTemplateCss(value))
  ) {
    return '';
  }

  return value;
}
