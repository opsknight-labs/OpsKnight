/**
 * Status Page Theme & Typography System
 * Centralized logic for color computation, dark/light contrast adaptation,
 * font family stacks, and CSS variable generation.
 */

export interface StatusPageFontOption {
  id: string;
  name: string;
  fontFamily: string;
  category: 'sans' | 'mono' | 'serif';
  previewText: string;
}

export const STATUS_PAGE_FONTS: StatusPageFontOption[] = [
  {
    id: 'default',
    name: 'Default (System Sans)',
    fontFamily:
      'var(--font-manrope), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category: 'sans',
    previewText: 'Aa Bb Cc 123',
  },
  {
    id: 'inter',
    name: 'Inter / Clean Sans',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    category: 'sans',
    previewText: 'Aa Bb Cc 123',
  },
  {
    id: 'segoe',
    name: 'Segoe UI / Modern',
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    category: 'sans',
    previewText: 'Aa Bb Cc 123',
  },
  {
    id: 'roboto',
    name: 'Roboto / Neutral',
    fontFamily: '"Roboto", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    category: 'sans',
    previewText: 'Aa Bb Cc 123',
  },
  {
    id: 'mono',
    name: 'Tech Monospace',
    fontFamily:
      '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    category: 'mono',
    previewText: 'const ok = 200;',
  },
  {
    id: 'serif',
    name: 'Editorial Serif',
    fontFamily: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    category: 'serif',
    previewText: 'Operational Digest',
  },
];

export function resolveStatusPageFontFamily(fontIdOrStack?: string | null): string {
  if (!fontIdOrStack) return STATUS_PAGE_FONTS[0].fontFamily;
  const matched = STATUS_PAGE_FONTS.find(f => f.id === fontIdOrStack);
  if (matched) return matched.fontFamily;
  return fontIdOrStack;
}

export function isDarkHex(colorHex?: string | null): boolean {
  if (!colorHex || typeof colorHex !== 'string') return false;
  const hex = colorHex.replace('#', '').trim();
  if (hex.length !== 3 && hex.length !== 6) return false;
  const fullHex =
    hex.length === 3
      ? hex
          .split('')
          .map(c => c + c)
          .join('')
      : hex;
  const num = parseInt(fullHex, 16);
  if (Number.isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  // Perceived luminance formula (HSP / Rec. 601)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance < 145;
}

export interface StatusPageColorPreset {
  id: string;
  name: string;
  description: string;
  primary: string;
  background: string;
  text: string;
}

export const STATUS_PAGE_COLOR_PRESETS: StatusPageColorPreset[] = [
  {
    id: 'modern-light',
    name: 'Modern Light',
    description: 'Clean indigo with crisp white panels',
    primary: '#4f46e5',
    background: '#f8fafc',
    text: '#0f172a',
  },
  {
    id: 'midnight-dark',
    name: 'Midnight Dark',
    description: 'Deep slate with emerald green status accents',
    primary: '#10b981',
    background: '#0f172a',
    text: '#f8fafc',
  },
  {
    id: 'oceanic-blue',
    name: 'Oceanic Blue',
    description: 'Vibrant sky blue with cool light background',
    primary: '#0284c7',
    background: '#f0f9ff',
    text: '#0c4a6e',
  },
  {
    id: 'cyberpunk-dark',
    name: 'Obsidian Glow',
    description: 'Electric violet on obsidian background',
    primary: '#a855f7',
    background: '#09090b',
    text: '#fafafa',
  },
  {
    id: 'sunset-minimal',
    name: 'Sunset Minimal',
    description: 'Warm amber with soft ivory background',
    primary: '#ea580c',
    background: '#fffbf5',
    text: '#1c1917',
  },
];

export interface StatusPageComputedTheme {
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  fontFamily: string;
  isDark: boolean;
  cssVariables: Record<string, string>;
}

export function computeStatusPageTheme(params: {
  primaryColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  fontFamily?: string | null;
}): StatusPageComputedTheme {
  const primary = params.primaryColor || '#667eea';
  const bg = params.backgroundColor || '#ffffff';
  const isDark = isDarkHex(bg);

  // Safeguard against contrast collisions:
  // If background is dark and text is left as default dark, switch to readable light text.
  // If background is light and text is left as white, switch to readable dark text.
  let text = params.textColor || (isDark ? '#f8fafc' : '#111827');
  if (isDark && isDarkHex(text)) {
    text = '#f8fafc';
  } else if (!isDark && !isDarkHex(text)) {
    text = '#111827';
  }

  const font = resolveStatusPageFontFamily(params.fontFamily);

  const panelBg = isDark
    ? `color-mix(in srgb, ${bg} 78%, #ffffff 22%)`
    : `color-mix(in srgb, #ffffff 95%, ${primary} 5%)`;

  const panelBorder = isDark
    ? `color-mix(in srgb, ${bg} 60%, #ffffff 40%)`
    : `color-mix(in srgb, #e2e8f0 82%, ${primary} 18%)`;

  const panelMutedBg = isDark
    ? `color-mix(in srgb, ${bg} 88%, #ffffff 12%)`
    : `color-mix(in srgb, #f8fafc 88%, ${primary} 12%)`;

  const panelMutedBorder = isDark
    ? `color-mix(in srgb, ${bg} 70%, #ffffff 30%)`
    : `color-mix(in srgb, #e2e8f0 80%, ${primary} 20%)`;

  const textMuted = isDark ? '#94a3b8' : '#64748b';
  const textSubtle = isDark ? '#64748b' : '#94a3b8';
  const cardShadow = isDark
    ? '0 10px 25px rgba(0, 0, 0, 0.4)'
    : '0 6px 16px rgba(15, 23, 42, 0.05)';

  const cssVariables: Record<string, string> = {
    '--status-primary': primary,
    '--status-primary-hover': `color-mix(in srgb, ${primary} 85%, #000000 15%)`,
    '--primary': primary,
    '--status-bg': bg,
    '--status-text': text,
    '--status-text-strong': text,
    '--status-text-muted': textMuted,
    '--status-text-subtle': textSubtle,
    '--sp-ink': text,
    '--sp-ink-strong': text,
    '--sp-muted': textMuted,
    '--status-panel-bg': panelBg,
    '--status-panel-border': panelBorder,
    '--status-panel-muted-bg': panelMutedBg,
    '--status-panel-muted-border': panelMutedBorder,
    '--status-card-shadow': cardShadow,
  };

  return {
    primaryColor: primary,
    backgroundColor: bg,
    textColor: text,
    fontFamily: font,
    isDark,
    cssVariables,
  };
}
