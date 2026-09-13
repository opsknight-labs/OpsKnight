export const STATUS_PAGE_THEME_VERSION = 1 as const;

export type StatusPageThemeFamily =
  | 'universal'
  | 'enterprise'
  | 'saas'
  | 'developer'
  | 'gaming'
  | 'regulated'
  | 'consumer';

export type StatusPageThemeDensity = 'comfortable' | 'compact';
export type StatusPageThemeMode = 'light' | 'dark';

export interface StatusPageThemeDefinition {
  id: string;
  version: typeof STATUS_PAGE_THEME_VERSION;
  name: string;
  family: StatusPageThemeFamily;
  description: string;
  mode: StatusPageThemeMode;
  preview: {
    surface: string;
    surfaceAlt: string;
    accent: string;
    text: string;
  };
  shape: {
    radius: string;
    shadow: string;
    header: 'classic' | 'split' | 'centered' | 'command';
    services: 'rows' | 'cards' | 'dense';
    incidents: 'timeline' | 'cards' | 'compact';
  };
}

function isDarkHex(value: string): boolean {
  const hex = value.replace('#', '').trim();
  if (hex.length !== 3 && hex.length !== 6) return false;
  const fullHex =
    hex.length === 3
      ? hex
          .split('')
          .map(part => part + part)
          .join('')
      : hex;
  const parsed = Number.parseInt(fullHex, 16);
  if (Number.isNaN(parsed)) return false;
  const red = (parsed >> 16) & 255;
  const green = (parsed >> 8) & 255;
  const blue = parsed & 255;
  return 0.299 * red + 0.587 * green + 0.114 * blue < 145;
}

const theme = (
  id: string,
  name: string,
  family: StatusPageThemeFamily,
  description: string,
  preview: StatusPageThemeDefinition['preview'],
  shape: StatusPageThemeDefinition['shape']
): StatusPageThemeDefinition => ({
  id,
  version: STATUS_PAGE_THEME_VERSION,
  name,
  family,
  description,
  mode: isDarkHex(preview.surface) ? 'dark' : 'light',
  preview,
  shape,
});

/**
 * Curated Status Page themes.
 *
 * `default` is deliberately special: it is the native Status Page renderer and compiles to no
 * theme CSS. This keeps "Default" honest — selecting it removes built-in template styling instead
 * of applying another reset skin.
 */
export const STATUS_PAGE_THEMES: readonly StatusPageThemeDefinition[] = [
  theme(
    'default',
    'Default',
    'universal',
    'OpsKnight’s natural status-page design. No built-in theme overrides are injected.',
    { surface: '#ffffff', surfaceAlt: '#f8fafc', accent: '#4f46e5', text: '#0f172a' },
    { radius: '12px', shadow: 'none', header: 'classic', services: 'rows', incidents: 'timeline' }
  ),
  theme(
    'executive',
    'Executive',
    'enterprise',
    'Conservative, premium presentation for established companies.',
    { surface: '#ffffff', surfaceAlt: '#f8fafc', accent: '#1d4ed8', text: '#0f172a' },
    {
      radius: '10px',
      shadow: '0 8px 22px rgb(15 23 42 / 0.06)',
      header: 'split',
      services: 'rows',
      incidents: 'compact',
    }
  ),
  theme(
    'enterprise-grid',
    'Enterprise Grid',
    'enterprise',
    'Structured grouping for broad service portfolios and operational teams.',
    { surface: '#ffffff', surfaceAlt: '#f1f5f9', accent: '#2563eb', text: '#111827' },
    {
      radius: '12px',
      shadow: '0 10px 28px rgb(15 23 42 / 0.07)',
      header: 'split',
      services: 'cards',
      incidents: 'cards',
    }
  ),
  theme(
    'global-operations',
    'Global Operations',
    'enterprise',
    'Dense operations-first layout for large infrastructure estates.',
    { surface: '#0f172a', surfaceAlt: '#172033', accent: '#38bdf8', text: '#f8fafc' },
    {
      radius: '8px',
      shadow: '0 14px 32px rgb(2 6 23 / 0.24)',
      header: 'command',
      services: 'dense',
      incidents: 'compact',
    }
  ),
  theme(
    'product-clean',
    'Product Clean',
    'saas',
    'Airy product-led styling with quiet panels and generous spacing.',
    { surface: '#ffffff', surfaceAlt: '#fafafa', accent: '#6366f1', text: '#18181b' },
    {
      radius: '14px',
      shadow: '0 6px 18px rgb(24 24 27 / 0.05)',
      header: 'classic',
      services: 'rows',
      incidents: 'timeline',
    }
  ),
  theme(
    'launch',
    'Launch',
    'saas',
    'Friendly startup presentation with a stronger hero and softer geometry.',
    { surface: '#ffffff', surfaceAlt: '#f5f3ff', accent: '#7c3aed', text: '#1f2937' },
    {
      radius: '18px',
      shadow: '0 12px 30px rgb(76 29 149 / 0.08)',
      header: 'centered',
      services: 'cards',
      incidents: 'cards',
    }
  ),
  theme(
    'signal',
    'Signal',
    'saas',
    'Crisp branded SaaS layout with stronger announcements and compact cards.',
    { surface: '#ffffff', surfaceAlt: '#ecfeff', accent: '#0891b2', text: '#0f172a' },
    {
      radius: '14px',
      shadow: '0 10px 24px rgb(8 145 178 / 0.08)',
      header: 'split',
      services: 'cards',
      incidents: 'compact',
    }
  ),
  theme(
    'cloud-control',
    'Cloud Control',
    'developer',
    'Technical infrastructure presentation with compact operational grouping.',
    { surface: '#f8fafc', surfaceAlt: '#eef2ff', accent: '#4f46e5', text: '#0f172a' },
    {
      radius: '8px',
      shadow: '0 8px 20px rgb(15 23 42 / 0.08)',
      header: 'command',
      services: 'dense',
      incidents: 'compact',
    }
  ),
  theme(
    'terminal',
    'Terminal',
    'developer',
    'Dark developer-first styling with restrained terminal cues.',
    { surface: '#09090b', surfaceAlt: '#18181b', accent: '#22c55e', text: '#f4f4f5' },
    {
      radius: '6px',
      shadow: '0 12px 30px rgb(0 0 0 / 0.32)',
      header: 'command',
      services: 'dense',
      incidents: 'compact',
    }
  ),
  theme(
    'arena-neon',
    'Arena Neon',
    'gaming',
    'Dark esports personality with controlled neon accents and angular surfaces.',
    { surface: '#090b14', surfaceAlt: '#111827', accent: '#22d3ee', text: '#f8fafc' },
    {
      radius: '4px',
      shadow: '0 0 24px rgb(34 211 238 / 0.12)',
      header: 'command',
      services: 'cards',
      incidents: 'cards',
    }
  ),
  theme(
    'command-center',
    'Command Center',
    'gaming',
    'Dense game/backend operations view without decorative HUD clutter.',
    { surface: '#0b1020', surfaceAlt: '#111a30', accent: '#a3e635', text: '#f8fafc' },
    {
      radius: '6px',
      shadow: '0 10px 26px rgb(0 0 0 / 0.3)',
      header: 'command',
      services: 'dense',
      incidents: 'compact',
    }
  ),
  theme(
    'finance-ledger',
    'Finance Ledger',
    'regulated',
    'Squared, restrained presentation for banking and fintech status pages.',
    { surface: '#ffffff', surfaceAlt: '#f3f4f6', accent: '#334155', text: '#111827' },
    {
      radius: '4px',
      shadow: '0 4px 12px rgb(15 23 42 / 0.05)',
      header: 'split',
      services: 'rows',
      incidents: 'compact',
    }
  ),
  theme(
    'health-clear',
    'Health Clear',
    'regulated',
    'Calm, high-whitespace layout designed for clarity and accessibility.',
    { surface: '#ffffff', surfaceAlt: '#f0fdfa', accent: '#0f766e', text: '#134e4a' },
    {
      radius: '12px',
      shadow: '0 6px 18px rgb(15 118 110 / 0.05)',
      header: 'classic',
      services: 'rows',
      incidents: 'timeline',
    }
  ),
  theme(
    'civic-trust',
    'Civic Trust',
    'regulated',
    'High-contrast public-sector hierarchy with restrained geometry.',
    { surface: '#ffffff', surfaceAlt: '#f8fafc', accent: '#1e3a8a', text: '#0f172a' },
    {
      radius: '6px',
      shadow: '0 4px 14px rgb(15 23 42 / 0.05)',
      header: 'split',
      services: 'rows',
      incidents: 'timeline',
    }
  ),
  theme(
    'studio',
    'Studio',
    'consumer',
    'Editorial spacing and clean surfaces for design, media, and luxury brands.',
    { surface: '#fffdf8', surfaceAlt: '#f8f5ef', accent: '#7c3aed', text: '#292524' },
    {
      radius: '2px',
      shadow: '0 10px 28px rgb(41 37 36 / 0.06)',
      header: 'centered',
      services: 'rows',
      incidents: 'cards',
    }
  ),
  theme(
    'pulse',
    'Pulse',
    'consumer',
    'Energetic consumer-facing layout with rounded geometry and lively grouping.',
    { surface: '#ffffff', surfaceAlt: '#fff1f2', accent: '#e11d48', text: '#1f2937' },
    {
      radius: '20px',
      shadow: '0 12px 30px rgb(225 29 72 / 0.08)',
      header: 'centered',
      services: 'cards',
      incidents: 'cards',
    }
  ),
] as const;

export const DEFAULT_STATUS_PAGE_THEME_ID = 'default';

const THEME_BY_ID = new Map(STATUS_PAGE_THEMES.map(item => [item.id, item] as const));

export function resolveStatusPageTheme(value: unknown): StatusPageThemeDefinition {
  return (typeof value === 'string' && THEME_BY_ID.get(value)) || STATUS_PAGE_THEMES[0];
}

export function resolveStatusPageThemeDensity(value: unknown): StatusPageThemeDensity {
  return value === 'compact' ? 'compact' : 'comfortable';
}

/** Old gallery templates were copied wholesale into branding.customCss. */
export function isLegacyStatusPageTemplateCss(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const sample = value.slice(0, 400);
  return /\/\*\s*Template:\s*[^*]+\*\//i.test(sample) && value.includes('.status-page-');
}

/**
 * Compile a built-in theme into the single deterministic override layer used by both the public
 * Status Page and the admin live preview.
 *
 * Operational/degraded/outage colors remain semantically owned by the base renderer. Dark themes
 * only provide dark-safe foreground/background values for those same semantics; they never change
 * what a status means. Customer Advanced CSS is applied after this layer and remains the final
 * override. Default is the native renderer and returns an empty string by contract.
 */
export function compileStatusPageThemeCss(themeId: unknown, densityValue?: unknown): string {
  const selected = resolveStatusPageTheme(themeId);
  if (selected.id === DEFAULT_STATUS_PAGE_THEME_ID) return '';

  const density = resolveStatusPageThemeDensity(densityValue);
  const compact = density === 'compact';
  const serviceGap = compact ? '0.55rem' : '0.85rem';
  const sectionGap = compact ? '1rem' : '1.5rem';
  const cardPadding = compact ? '0.75rem' : '1rem';
  const { shape, preview } = selected;
  const accentContrast = isDarkHex(preview.accent) ? '#ffffff' : '#0b1020';

  const serviceLayout =
    shape.services === 'cards'
      ? `.status-page-container .status-v3-services__list { grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }`
      : shape.services === 'dense'
        ? `.status-page-container .status-v3-service { padding-block: ${compact ? '0.55rem' : '0.7rem'}; }`
        : '';

  const headerLayout =
    shape.header === 'centered'
      ? `.status-page-container .status-topbar__inner { justify-content: center; text-align: center; flex-wrap: wrap; }\n.status-page-container .status-topbar__actions { justify-content: center; }`
      : shape.header === 'command'
        ? `.status-page-container .status-topbar { border-bottom-style: dashed; }\n.status-page-container .status-topbar__inner { letter-spacing: 0.01em; }`
        : shape.header === 'split'
          ? `.status-page-container .status-topbar__inner { justify-content: space-between; }`
          : '';

  const incidentLayout =
    shape.incidents === 'compact'
      ? `.status-page-container .status-v3-incident-pill__summary { padding: ${compact ? '0.7rem' : '0.85rem'}; }`
      : shape.incidents === 'cards'
        ? `.status-page-container details.status-v3-incident-pill { border-radius: calc(${shape.radius} + 2px); }`
        : '';

  // SnapshotView currently carries branding variables inline on the outer container. Inline custom
  // properties outrank built-in theme CSS on that same element, which is mostly invisible on light
  // themes because their ink is similar to the native palette but can make dark themes inherit dark
  // branding text. Re-declaring the selected dark palette on the child surface wins by normal
  // inheritance without using !important and keeps Advanced CSS free to override it afterwards.
  const darkSurfaceLayer =
    selected.mode === 'dark'
      ? `
.status-page-container,
.status-page-container .status-page-surface {
  color-scheme: dark;
}
.status-page-container .status-page-surface {
  --sp-ink: ${preview.text};
  --sp-ink-strong: ${preview.text};
  --sp-muted: color-mix(in srgb, ${preview.text} 72%, ${preview.surface} 28%);
  --sp-muted-2: color-mix(in srgb, ${preview.text} 56%, ${preview.surface} 44%);
  --sp-panel-bg: ${preview.surface};
  --sp-panel-muted-bg: ${preview.surfaceAlt};
  --sp-panel-border: color-mix(in srgb, ${preview.text} 16%, ${preview.surface} 84%);
  --sp-panel-muted-border: color-mix(in srgb, ${preview.text} 13%, ${preview.surfaceAlt} 87%);
  --status-panel-bg: ${preview.surface};
  --status-panel-muted-bg: ${preview.surfaceAlt};
  --status-panel-border: color-mix(in srgb, ${preview.text} 16%, ${preview.surface} 84%);
  --status-text: ${preview.text};
  --status-text-strong: ${preview.text};
  --status-text-muted: color-mix(in srgb, ${preview.text} 72%, ${preview.surface} 28%);
  --status-primary: var(--sp-theme-accent);
  --status-primary-hover: color-mix(in srgb, var(--sp-theme-accent) 82%, #000000 18%);
  --primary: var(--sp-theme-accent);
  --primary-hover: color-mix(in srgb, var(--sp-theme-accent) 82%, #000000 18%);
}
.status-page-container .status-v3-service {
  background: var(--sp-panel-bg);
  color: var(--status-text);
}
.status-page-container .status-topbar__chip--accent,
.status-page-container .status-subscribe__button,
.status-page-container .status-subscribe__check--on .status-subscribe__check-box {
  color: var(--sp-theme-accent-contrast);
}
.status-page-container [data-badge="true"][data-variant="success"] {
  background: linear-gradient(to right, #047857, #15803d) !important;
  color: #ffffff !important;
}
.status-page-container [data-badge="true"][data-variant="warning"] {
  background: linear-gradient(to right, #b45309, #c2410c) !important;
  color: #ffffff !important;
}
.status-page-container [data-badge="true"][data-variant="info"] {
  background: linear-gradient(to right, #2563eb, #4338ca) !important;
  color: #ffffff !important;
}
.status-page-container [data-badge="true"][data-variant="danger"] {
  background: linear-gradient(to right, #dc2626, #be123c) !important;
  color: #ffffff !important;
}
`
      : '';

  return `
/* OpsKnight Status Page Theme: ${selected.name} v${selected.version} */
.status-page-container {
  --sp-page-bg: ${preview.surfaceAlt};
  --sp-page-text: ${preview.text};
  --sp-panel-bg: ${preview.surface};
  --sp-panel-muted-bg: ${preview.surfaceAlt};
  --status-panel-bg: ${preview.surface};
  --status-panel-muted-bg: ${preview.surfaceAlt};
  --status-text: ${preview.text};
  --status-text-strong: ${preview.text};
  --status-text-muted: color-mix(in srgb, ${preview.text} 72%, ${preview.surface} 28%);
  --sp-ink: ${preview.text};
  --sp-ink-strong: ${preview.text};
  --sp-muted: color-mix(in srgb, ${preview.text} 72%, ${preview.surface} 28%);
  --sp-muted-2: color-mix(in srgb, ${preview.text} 56%, ${preview.surface} 44%);
  --sp-panel-border: color-mix(in srgb, ${preview.text} 16%, ${preview.surface} 84%);
  --sp-panel-muted-border: color-mix(in srgb, ${preview.text} 13%, ${preview.surfaceAlt} 87%);
  --sp-theme-accent: ${preview.accent};
  --sp-theme-accent-contrast: ${accentContrast};
  --sp-theme-radius: ${shape.radius};
  --sp-theme-shadow: ${shape.shadow};
  --sp-theme-card-padding: ${cardPadding};
  --sp-theme-service-gap: ${serviceGap};
  --sp-theme-section-gap: ${sectionGap};
}
${darkSurfaceLayer}
.status-page-container .status-topbar,
.status-page-container .status-page-header {
  background: color-mix(in srgb, var(--sp-panel-bg) 92%, var(--sp-theme-accent) 8%);
  border-bottom-color: color-mix(in srgb, var(--sp-panel-border) 72%, var(--sp-theme-accent) 28%);
}
.status-page-container .status-v3-service,
.status-page-container details.status-v3-incident-pill {
  border-radius: var(--sp-theme-radius);
  border-color: color-mix(in srgb, var(--sp-panel-border) 86%, var(--sp-theme-accent) 14%);
  box-shadow: var(--sp-theme-shadow);
}
.status-page-container .status-v3-service {
  padding: var(--sp-theme-card-padding);
}
.status-page-container .status-v3-services__list,
.status-page-container .status-v3-incidents__list {
  gap: var(--sp-theme-service-gap);
}
.status-page-container section {
  margin-block: var(--sp-theme-section-gap);
}
${headerLayout}
${serviceLayout}
${incidentLayout}
`;
}
