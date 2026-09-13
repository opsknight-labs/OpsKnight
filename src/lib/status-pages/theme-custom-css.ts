import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
} from '@/lib/status-pages/theme-contract';

/**
 * TEMPORARY diagnostic for PR #650.
 *
 * Local testing still shows white V3 service cards on curated dark themes. To prove or disprove
 * Advanced CSS as the winning background source, dark curated themes intentionally receive no
 * branding.customCss at all while this diagnostic is enabled.
 *
 * Do not remove this guard until the local white-card reproduction has been retested. If the card
 * is still white with this enabled, branding.customCss is conclusively not the source and the next
 * investigation should inspect the browser's computed background declaration.
 */
const DISABLE_DARK_THEME_CUSTOM_CSS_FOR_DIAGNOSTIC = true;

/**
 * Older gallery CSS was stored wholesale in branding.customCss. Some persisted payloads can lose
 * the leading `/* Template: ... *\/` marker during migrations/edits while retaining the distinctive
 * template structure. Detect that structure conservatively so curated themes do not inherit stale
 * `!important` light-card rules.
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
 * Resolve the Advanced CSS that is allowed to reach the public renderer and the theme preview.
 *
 * Default deliberately preserves legacy CSS for backwards compatibility. Curated themes suppress
 * positively identified old gallery templates. During the PR #650 diagnostic, dark curated themes
 * suppress every Advanced CSS payload so local testing can isolate the remaining white-card source.
 */
export function resolveStatusPageCustomCss(themeId: unknown, value: unknown): string {
  if (typeof value !== 'string') return '';

  const selectedTheme = resolveStatusPageTheme(themeId);

  if (
    DISABLE_DARK_THEME_CUSTOM_CSS_FOR_DIAGNOSTIC &&
    selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID &&
    selectedTheme.mode === 'dark'
  ) {
    return '';
  }

  if (
    selectedTheme.id !== DEFAULT_STATUS_PAGE_THEME_ID &&
    (isLegacyStatusPageTemplateCss(value) || looksLikeLegacyStatusPageTemplateCss(value))
  ) {
    return '';
  }

  return value;
}
