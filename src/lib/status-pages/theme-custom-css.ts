import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
} from '@/lib/status-pages/theme-contract';

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
    isLegacyStatusPageTemplateCss(value)
  ) {
    return '';
  }

  return value;
}
