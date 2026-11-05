import { SURFACE, TONES, OUTLOOK_WIDTH } from './tokens';

type DarkRule = {
  /** Class hook (without the dot). */
  cls: string;
  color?: string;
  background?: string;
  border?: string;
  /** Keeps a 4px status accent after `border` repaints every side. */
  borderLeft?: string;
};

const D = SURFACE.dark;

/** Every element that changes in dark mode carries one of these `dm-*` classes. */
const DARK_RULES: DarkRule[] = [
  { cls: 'dm-bg-page', background: D.page },
  { cls: 'dm-bg-card', background: D.card, border: D.border },
  { cls: 'dm-bg-muted', background: D.muted, border: D.border },
  { cls: 'dm-border', border: D.border },
  { cls: 'dm-text-heading', color: D.heading },
  { cls: 'dm-text-body', color: D.body },
  { cls: 'dm-text-muted', color: D.muted_text },
  { cls: 'dm-text-brand', color: D.heading },
  { cls: 'dm-link', color: D.link },
  { cls: 'dm-info-row-even', background: D.card },
  { cls: 'dm-info-row-odd', background: D.muted },
  { cls: 'dm-info-label', color: D.muted_text, border: D.border },
  { cls: 'dm-info-value', color: D.body, border: D.border },
  ...Object.entries(TONES).flatMap(([tone, t]) => [
    { cls: `dm-soft-${tone}`, background: t.softDark },
    { cls: `dm-ink-${tone}`, color: t.inkDark },
  ]),
  // Last, so the accent wins over the `border` repaint above.
  ...Object.entries(TONES).map(([tone, t]) => ({
    cls: `dm-accent-${tone}`,
    borderLeft: t.border,
  })),
];

function declarations(rule: DarkRule, parts: Array<'color' | 'background' | 'border'>): string {
  const out: string[] = [];
  if (parts.includes('border') && rule.borderLeft)
    out.push(`border-left-color:${rule.borderLeft}!important`);
  if (parts.includes('color') && rule.color) out.push(`color:${rule.color}!important`);
  if (parts.includes('background') && rule.background)
    out.push(`background-color:${rule.background}!important`);
  if (parts.includes('border') && rule.border) out.push(`border-color:${rule.border}!important`);
  return out.join(';');
}

/**
 * Three dark-mode layers, one source of truth:
 * 1. `prefers-color-scheme: dark`: Apple Mail, Outlook for Mac/iOS, iOS Mail, some Android clients.
 * 2. `[data-ogsc]` (text) / `[data-ogsb]` (backgrounds): Outlook.com and new Outlook,
 *    which ignore the media query but tag the message wrapper with these attributes.
 * 3. Forced-inversion clients (Gmail apps, Outlook for Windows) apply no CSS at all; the
 *    palette is built to survive inversion (off-white surfaces, solid `bgcolor` fills).
 */
export function darkModeCss(): string {
  const media = DARK_RULES.map(
    r => `.${r.cls}{${declarations(r, ['color', 'background', 'border'])}}`
  ).join('');
  const ogsc = DARK_RULES.filter(r => r.color)
    .map(r => `[data-ogsc] .${r.cls}{${declarations(r, ['color'])}}`)
    .join('');
  const ogsb = DARK_RULES.filter(r => r.background || r.border || r.borderLeft)
    .map(r => `[data-ogsb] .${r.cls}{${declarations(r, ['background', 'border'])}}`)
    .join('');
  return `@media (prefers-color-scheme:dark){body{background-color:${D.page}!important}${media}}${ogsc}${ogsb}`;
}

/** Base reset, mobile and big-screen tiers (Outlook desktop ignores all media queries). */
export function layoutCss(): string {
  return [
    ':root{color-scheme:light dark;supported-color-schemes:light dark}',
    'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important}',
    '*{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%}',
    'table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse}',
    'img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none}',
    'a{text-decoration:none}',
    'a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}',
    'u+#body a{color:inherit;text-decoration:none;font-size:inherit;font-family:inherit;font-weight:inherit;line-height:inherit}',
    // Mobile (<= 640px)
    '@media only screen and (max-width:640px){' +
      '.mobile-outer-padding{padding:16px 10px!important}' +
      '.mobile-container{width:100%!important;max-width:100%!important}' +
      '.mobile-card{border-radius:12px!important}' +
      '.mobile-header-padding{padding:24px 20px!important}' +
      '.mobile-padding{padding:24px 20px!important}' +
      '.mobile-font-large{font-size:21px!important;line-height:1.3!important}' +
      '.mobile-full-width{width:100%!important;max-width:100%!important}' +
      '.mobile-button a{display:block!important;width:auto!important;padding:14px 16px!important}' +
      '.mobile-table-cell{padding:10px 12px!important;font-size:13px!important}' +
      '.mobile-table-label{width:38%!important}' +
      '.mobile-hide{display:none!important;max-height:0!important;overflow:hidden!important}' +
      '}',
    // Desktop (>= 1024px)
    '@media only screen and (min-width:1024px){' +
      '.desktop-container{max-width:860px!important;width:90%!important}' +
      '.desktop-header-padding{padding:40px 48px!important}' +
      '.desktop-padding{padding:36px 48px!important}' +
      '.desktop-font-title{font-size:30px!important}' +
      '.desktop-font-body{font-size:15px!important;line-height:1.65!important}' +
      '.desktop-table-cell{padding:14px 22px!important;font-size:15px!important}' +
      '}',
    // 27-inch / QHD (>= 1440px)
    '@media only screen and (min-width:1440px){' +
      '.desktop-container{max-width:1080px!important;width:88%!important}' +
      '.desktop-outer-padding{padding:56px 48px!important}' +
      '.desktop-header-padding{padding:54px 64px!important}' +
      '.desktop-padding{padding:48px 64px!important}' +
      '.desktop-font-title{font-size:34px!important}' +
      '.desktop-font-body{font-size:16px!important;line-height:1.75!important}' +
      '.desktop-logo-chip{width:52px!important;height:52px!important}' +
      '.desktop-logo-img{width:31px!important;height:34px!important}' +
      '.desktop-logo-name{font-size:24px!important}' +
      '.desktop-table-cell{padding:16px 30px!important;font-size:16px!important}' +
      '}',
    // Ultrawide / 4K (>= 1920px)
    '@media only screen and (min-width:1920px){' +
      '.desktop-container{max-width:1180px!important;width:85%!important}' +
      '.desktop-outer-padding{padding:64px 64px!important}' +
      '.desktop-header-padding{padding:60px 76px!important}' +
      '.desktop-padding{padding:54px 76px!important}' +
      '.desktop-font-title{font-size:36px!important}' +
      '.desktop-logo-chip{width:56px!important;height:56px!important}' +
      '.desktop-logo-img{width:33px!important;height:36px!important}' +
      '.desktop-logo-name{font-size:26px!important}' +
      '.desktop-table-cell{padding:18px 34px!important}' +
      '}',
  ].join('');
}

/** Outlook (Word) only: real fonts instead of Times New Roman, exact line heights, fixed width. */
export function outlookHeadHtml(): string {
  return [
    '<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->',
    '<!--[if mso]><style type="text/css">',
    "body,table,td,th,div,p,h1,h2,h3,a,span,li{font-family:'Segoe UI',Arial,sans-serif!important}",
    'td,th,p,h1,h2,h3{mso-line-height-rule:exactly}',
    `.mso-container{width:${OUTLOOK_WIDTH}px!important}`,
    '</style><![endif]-->',
  ].join('');
}
