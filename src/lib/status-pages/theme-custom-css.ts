import { isLegacyStatusPageTemplateCss } from '@/lib/status-pages/theme-contract';

/**
 * Resolve the Advanced CSS that is allowed to reach the public renderer.
 *
 * Old custom CSS templates from the retired template gallery are deprecated and purged.
 * They are stripped completely across all themes so they do not conflict with built-in theme styles.
 * Genuine customer-authored Advanced CSS remains the final override layer.
 */
export function resolveStatusPageCustomCss(_themeId: unknown, value: unknown): string {
  if (typeof value !== 'string') return '';

  if (isLegacyStatusPageTemplateCss(value)) {
    return '';
  }

  return value;
}
