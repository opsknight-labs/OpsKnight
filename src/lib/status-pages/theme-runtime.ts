import { resolveStatusPageTheme } from '@/lib/status-pages/theme-contract';

export type StatusPageThemeRuntimeVariables = Record<`--${string}`, string>;

/**
 * Core appearance tokens applied directly to the V3 surface.
 *
 * The compiled theme stylesheet still owns layout, semantic status presentation, badges and
 * decorative details. These variables are deliberately duplicated at the runtime surface boundary
 * so the public renderer and the shadow-DOM preview cannot diverge because of stylesheet order or
 * inherited legacy branding variables.
 *
 * Default returns no variables by contract and therefore remains the native OpsKnight renderer.
 */
export function resolveStatusPageThemeRuntimeVariables(
  themeId: unknown
): StatusPageThemeRuntimeVariables {
  const theme = resolveStatusPageTheme(themeId);
  if (theme.id === 'default') return {};

  const { preview } = theme;
  const border = `color-mix(in srgb, ${preview.text} 16%, ${preview.surface} 84%)`;
  const mutedBorder = `color-mix(in srgb, ${preview.text} 13%, ${preview.surfaceAlt} 87%)`;
  const mutedText = `color-mix(in srgb, ${preview.text} 72%, ${preview.surface} 28%)`;
  const subtleText = `color-mix(in srgb, ${preview.text} 56%, ${preview.surface} 44%)`;

  return {
    '--sp-page-bg': preview.surfaceAlt,
    '--sp-page-text': preview.text,
    '--sp-ink': preview.text,
    '--sp-ink-strong': preview.text,
    '--sp-muted': mutedText,
    '--sp-muted-2': subtleText,
    '--sp-panel-bg': preview.surface,
    '--sp-panel-muted-bg': preview.surfaceAlt,
    '--sp-panel-border': border,
    '--sp-panel-muted-border': mutedBorder,
    '--sp-theme-accent': preview.accent,
    '--status-text': preview.text,
    '--status-text-strong': preview.text,
    '--status-text-muted': mutedText,
    '--status-text-subtle': subtleText,
    '--status-panel-bg': preview.surface,
    '--status-panel-muted-bg': preview.surfaceAlt,
    '--status-panel-border': border,
    '--status-panel-muted-border': mutedBorder,
    '--status-primary': preview.accent,
    '--primary': preview.accent,
    '--primary-color': preview.accent,
  };
}
