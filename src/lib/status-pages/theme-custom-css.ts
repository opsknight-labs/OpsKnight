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
    value.includes("form button[type='submit']") ||
    value.includes('Template text overrides');

  return hasServiceCard && hasContainer && hasLegacyChrome;
}

function parseHexLightness(value: string): boolean | null {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  const raw = match[1];
  const hex =
    raw.length === 3
      ? raw
          .split('')
          .map(part => part + part)
          .join('')
      : raw;
  const parsed = Number.parseInt(hex, 16);
  if (Number.isNaN(parsed)) return null;

  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;
  const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
  return luminance >= 185;
}

function isHardCodedLightBackground(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'white') return true;

  const hexLight = parseHexLightness(normalized);
  if (hexLight !== null) return hexLight;

  const rgb = normalized.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/
  );
  if (!rgb) return false;

  const red = Math.min(255, Number(rgb[1]));
  const green = Math.min(255, Number(rgb[2]));
  const blue = Math.min(255, Number(rgb[3]));
  return 0.299 * red + 0.587 * green + 0.114 * blue >= 185;
}

/**
 * Some installations contain a partially edited legacy template rather than the complete template
 * payload. In that case the broad template fingerprint above cannot safely classify the entire CSS
 * string, but the old compatibility aliases can still force a white card with `!important`.
 *
 * For dark curated themes only, drop those specific legacy-alias rules when they hard-code a light
 * important background. Modern `.status-v3-*` Advanced CSS remains untouched and therefore keeps
 * the documented final-override behavior.
 */
function stripConflictingLegacyLightSurfaceRules(value: string): string {
  return value.replace(
    /([^{}]*(?:\.status-service-card|\.status-incident-card)[^{}]*)\{([^{}]*)\}/gi,
    (rule, selector: string, declarations: string) => {
      const backgrounds = [
        ...declarations.matchAll(
          /(?:^|;)\s*background(?:-color)?\s*:\s*([^;!]+?)\s*!important\b/gi
        ),
      ];
      const forcesLightSurface = backgrounds.some(match => isHardCodedLightBackground(match[1]));
      return forcesLightSurface ? '' : rule;
    }
  );
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
  if (selectedTheme.id === DEFAULT_STATUS_PAGE_THEME_ID) return value;

  if (isLegacyStatusPageTemplateCss(value) || looksLikeLegacyStatusPageTemplateCss(value)) {
    return '';
  }

  if (selectedTheme.mode === 'dark') {
    return stripConflictingLegacyLightSurfaceRules(value);
  }

  return value;
}
