/**
 * Reusable Email Components
 * Modern, responsive HTML components for email templates
 */

export interface EmailStyles {
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  headerGradient?: string;
  logoUrl?: string;
  logoAlt?: string;
  brandName?: string;
  buttonBackground?: string;
  buttonTextColor?: string;
  buttonShadow?: string;
}

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '#';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    const unescaped = trimmed.replace(/&amp;/g, '&');
    return escapeHtml(unescaped);
  }
  return '#';
}

/**
 * Email container with responsive layout and OpsKnight branding
 * Fully optimized for mobile devices
 */
export function EmailContainer(content: string, styles: EmailStyles = {}): string {
  const backgroundColor = styles.backgroundColor || '#ffffff';
  const outerBackground = '#f3f4f6';

  return `
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>OpsKnight Notification</title>
    <!--[if gte mso 9]>
    <xml>
        <o:OfficeDocumentSettings>
            <o:AllowPNG/>
            <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
    </xml>
    <![endif]-->
    <style type="text/css">
        :root { color-scheme: light; supported-color-schemes: light; }
        @media only screen and (max-width: 600px) {
            .mobile-padding { padding: 20px !important; }
            .mobile-text-center { text-align: center !important; }
            .mobile-full-width { width: 100% !important; max-width: 100% !important; }
            .mobile-font-large { font-size: 24px !important; }
            .mobile-font-medium { font-size: 16px !important; }
            .mobile-font-small { font-size: 14px !important; }
            .mobile-button { width: 100% !important; display: block !important; }
            .mobile-button a { width: 100% !important; box-sizing: border-box !important; }
            .mobile-hide { display: none !important; }
            .mobile-header-padding { padding: 32px 20px !important; }
            .mobile-logo-name { font-size: 20px !important; }
            .mobile-spacing { margin: 16px 0 !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${outerBackground}; font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; color: #1e293b;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${outerBackground};">
        <tr>
            <td align="center" style="padding: 40px 10px;">
                <!--[if mso]>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" align="center">
                <tr>
                <td>
                <![endif]-->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: ${backgroundColor}; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01); border: 1px solid #e5e7eb;">
                    <tr>
                        <td style="padding: 0;">
                            ${content}
                        </td>
                    </tr>
                </table>
                <!--[if mso]>
                </td>
                </tr>
                </table>
                <![endif]-->
            </td>
        </tr>
    </table>
</body>
</html>`.trim();
}

/**
 * Branded email header with OpsKnight logo and red gradient
 * Mobile-responsive with flexible layout
 */
export function EmailHeader(title: string, subtitle?: string, styles: EmailStyles = {}): string {
  const headerGradient =
    styles.headerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 40%, #475569 100%)';
  const brandName = escapeHtml(styles.brandName || 'OpsKnight');
  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : undefined;

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td class="mobile-header-padding" style="background: ${headerGradient}; padding: 48px 44px; text-align: left; position: relative;">
            <!-- Logo with Brand Name -->
            <div style="margin-bottom: 32px;">
                <!--[if mso]>
                <table role="presentation" align="left"><tr><td>
                <![endif]-->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left" style="margin: 0;">
                    <tr>
                        <td style="padding-right: 12px; vertical-align: middle;">
                            ${getOpsKnightLogo(56, styles)}
                        </td>
                        <td style="vertical-align: middle;">
                            <span class="mobile-logo-name" style="font-size: 24px; font-weight: 700; color: #ffffff !important; letter-spacing: -0.01em; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap;">${brandName}</span>
                        </td>
                    </tr>
                </table>
                <!--[if mso]>
                </td></tr></table>
                <![endif]-->
                <div style="clear: both;"></div>
            </div>
            
            <!-- Title -->
            <h1 class="mobile-font-large" style="margin: 0 0 ${safeSubtitle ? '10px' : '0'} 0; color: #ffffff !important; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25;">
                ${safeTitle}
            </h1>
            
            ${
              safeSubtitle
                ? `
            <!-- Subtitle -->
            <p class="mobile-font-small" style="margin: 0; color: rgba(255, 255, 255, 0.85) !important; font-size: 15px; font-weight: 500;">
                ${safeSubtitle}
            </p>
            `
                : ''
            }
        </td>
    </tr>
</table>`.trim();
}

/**
 * Content section with responsive padding
 */
export function EmailContent(content: string): string {
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td class="mobile-padding" style="padding: 52px 44px; background: #ffffff;">
            ${content}
        </td>
    </tr>
</table>`.trim();
}

/**
 * Status badge with icon - OpsKnight branded
 */
export function StatusBadge(
  status: string,
  type: 'success' | 'warning' | 'error' | 'info' = 'info'
): string {
  const colors = {
    success: {
      bg: '#059669',
      text: '#ffffff',
      icon: getCheckIcon(16, '#ffffff'),
      shadow: 'rgba(5, 150, 105, 0.2)',
    },
    warning: {
      bg: '#d97706',
      text: '#ffffff',
      icon: getWarningIcon(16, '#ffffff'),
      shadow: 'rgba(217, 119, 6, 0.2)',
    },
    error: {
      bg: '#be123c',
      text: '#ffffff',
      icon: getErrorIcon(16, '#ffffff'),
      shadow: 'rgba(190, 18, 60, 0.2)',
    },
    info: {
      bg: '#2563eb',
      text: '#ffffff',
      icon: getInfoIcon(16, '#ffffff'),
      shadow: 'rgba(37, 99, 235, 0.2)',
    },
  };

  const color = colors[type];
  const safeStatus = escapeHtml(status);

  return `
<div style="display: inline-flex; align-items: center; gap: 10px; background: ${color.bg}; color: ${color.text}; padding: 12px 24px; border-radius: 999px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; box-shadow: 0 4px 14px ${color.shadow}, 0 0 0 1px rgba(255, 255, 255, 0.1) inset;">
    <span style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);"></span>
    <span>${safeStatus}</span>
</div>`.trim();
}

/**
 * Call-to-action button with OpsKnight red gradient
 * Optimized for mobile with large touch targets
 */
export function EmailButton(text: string, url: string, _styles: EmailStyles = {}): string {
  const buttonBackground =
    _styles.buttonBackground || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)';
  const buttonShadow = _styles.buttonShadow || '0 8px 20px rgba(30, 41, 59, 0.25)';
  const buttonTextColor = _styles.buttonTextColor || '#ffffff';
  const safeText = escapeHtml(text);
  const safeUrl = sanitizeUrl(url);

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" class="mobile-full-width mobile-spacing" style="margin: 32px auto; width: auto;">
    <tr>
        <td class="mobile-button" style="border-radius: 10px; background: ${buttonBackground}; text-align: center; box-shadow: ${buttonShadow};">
            <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; color: ${buttonTextColor} !important; text-decoration: none; font-weight: 600; font-size: 15px; line-height: 1.5; border-radius: 10px; min-width: 220px; text-align: center;">
                ${safeText}
            </a>
        </td>
    </tr>
</table>`.trim();
}

/**
 * Information card with label and value
 */
export function InfoCard(
  items: Array<{ label: string; value: string; highlight?: boolean }>,
  styles: { accentColor?: string } = {}
): string {
  const accentColor = styles.accentColor || '#e5e7eb';
  const rows = items
    .map(
      item => `
        <tr>
            <td style="padding: 12px 20px; border-bottom: 1px solid #e5e7eb; font-size: 14px; font-weight: 600; color: #6b7280; width: 140px;">
                ${escapeHtml(item.label)}
            </td>
            <td style="padding: 12px 20px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #1f2937; ${item.highlight ? 'font-weight: 600;' : ''}">
                ${escapeHtml(item.value)}
            </td>
        </tr>
    `
    )
    .join('');

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #ffffff; border-radius: 10px; overflow: hidden; border: 1px solid #e5e7eb; border-left: 4px solid ${accentColor};">
    ${rows}
</table>`.trim();
}

/**
 * Alert box for important messages with OpsKnight colors
 */
export function AlertBox(
  title: string,
  message: string,
  type: 'success' | 'warning' | 'error' | 'info' = 'info'
): string {
  const colors = {
    success: { bg: '#f0fdf4', border: '#059669', title: '#064e3b', text: '#065f46' },
    warning: { bg: '#fffbeb', border: '#d97706', title: '#78350f', text: '#92400e' },
    error: { bg: '#fef2f2', border: '#be123c', title: '#881337', text: '#991b1b' },
    info: { bg: '#eff6ff', border: '#2563eb', title: '#1e40af', text: '#1e3a8a' },
  };

  const color = colors[type];
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `
<div style="background: ${color.bg}; border-left: 4px solid ${color.border}; padding: 24px; border-radius: 12px; margin: 24px 0;">
    <h3 style="margin: 0 0 12px 0; color: ${color.title}; font-size: 18px; font-weight: 700; letter-spacing: -0.01em;">
        ${safeTitle}
    </h3>
    <p style="margin: 0; color: ${color.text}; font-size: 15px; line-height: 1.7;">
        ${safeMessage}
    </p>
</div>`.trim();
}

/**
 * Footer with OpsKnight branding
 */
export function EmailFooter(unsubscribeUrl?: string): string {
  const safeUnsubscribe = unsubscribeUrl ? sanitizeUrl(unsubscribeUrl) : undefined;
  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td style="padding: 36px 40px; background: #f3f4f6; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="margin: 0 0 12px 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                This is an automated notification from <strong style="color: #1e293b;">OpsKnight</strong> Incident Management.
            </p>
            ${
              safeUnsubscribe && safeUnsubscribe !== '#'
                ? `
            <p style="margin: 12px 0 0 0; font-size: 13px;">
                <a href="${safeUnsubscribe}" style="color: #1e293b; text-decoration: none; font-weight: 600;">Unsubscribe from these emails</a>
            </p>
            `
                : ''
            }
        </td>
    </tr>
</table>`.trim();
}

/**
 * SVG Icons (inline for email compatibility)
 */

/**
 * Header specifically for Status Page Subscribers
 * Shows the Organization Name prominently instead of OpsKnight
 * Maintains the premium OpsKnight aesthetic
 */
export function SubscriberEmailHeader(
  pageName: string,
  title: string,
  subtitle?: string,
  styles: EmailStyles = {}
): string {
  const headerGradient =
    styles.headerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 40%, #475569 100%)';
  const displayName = escapeHtml(styles.brandName || pageName);
  const logoAlt = escapeHtml(styles.logoAlt || displayName);
  const brandLogo = getOpsKnightLogo(52, {
    ...styles,
    logoAlt,
  });
  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : undefined;

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td class="mobile-header-padding" style="background: ${headerGradient}; padding: 48px 44px; text-align: left; position: relative;">
            <!-- Brand Header -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 28px;">
                <tr>
                    <td align="left" valign="middle">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                                <td style="padding-right: 12px; vertical-align: middle;">
                                    ${brandLogo}
                                </td>
                                <td style="vertical-align: middle;">
                                    <span class="mobile-logo-name" style="font-size: 22px; font-weight: 700; color: #ffffff !important; letter-spacing: -0.01em; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap;">
                                        ${displayName}
                                    </span>
                                </td>
                            </tr>
                        </table>
                    </td>
                    <td align="right" valign="middle" class="mobile-hide" style="color: rgba(255, 255, 255, 0.6); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">
                        Powered by OpsKnight
                    </td>
                </tr>
            </table>

            <!-- Organization Name (The Sender) -->
            <h1 class="mobile-font-large" style="margin: 0 0 14px 0; color: #ffffff !important; font-size: 30px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25;">
                ${displayName}
            </h1>
            
            <!-- Update Type Badge -->
            <div style="margin-bottom: 24px;">
                <span style="display: inline-block; padding: 6px 14px; background: rgba(255, 255, 255, 0.16); border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 10px; color: #ffffff !important; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${safeTitle}
                </span>
            </div>

            ${
              safeSubtitle
                ? `
            <p class="mobile-font-medium" style="margin: 0; color: rgba(255, 255, 255, 0.9) !important; font-size: 16px; font-weight: 500; line-height: 1.5;">
                ${safeSubtitle}
            </p>
            `
                : ''
            }
        </td>
    </tr>
</table>`.trim();
}

/**
 * Footer providing "Powered by" marketing while handling Unsubscribe
 */
export function SubscriberEmailFooter(unsubscribeUrl: string, pageName: string): string {
  const safeUnsubscribe = sanitizeUrl(unsubscribeUrl);
  const safePageName = escapeHtml(pageName);

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td style="padding: 36px 20px; background: #f8fafc; border-top: 1px solid #e5e7eb; text-align: center;">
            <p style="margin: 0 0 16px 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                You received this email because you are subscribed to <strong>${safePageName}</strong> updates.
            </p>
            
            <p style="margin: 0 0 32px 0; font-size: 13px;">
                <a href="${safeUnsubscribe}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from updates</a>
            </p>

            <!-- OpsKnight Marketing -->
            <div style="opacity: 0.8;">
                <p style="margin: 0; color: #9ca3af; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em;">
                    Powered by
                </p>
                <a href="https://OpsKnight.com" target="_blank" style="text-decoration: none; display: inline-block; margin-top: 8px;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        ${getOpsKnightLogo(24)}
                        <span style="color: #1f2937; font-size: 16px; font-weight: 700; font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.02em;">OpsKnight</span>
                    </div>
                </a>
            </div>
        </td>
    </tr>
</table>`.trim();
}

/**
 * SVG Icons (inline for email compatibility)
 */

function getOpsKnightLogo(width: number, styles: EmailStyles = {}): string {
  const logoUrl = styles.logoUrl || getDefaultLogoUrl();
  const logoAlt = escapeHtml(styles.logoAlt || 'OpsKnight');
  if (logoUrl) {
    const safeLogoUrl = sanitizeUrl(logoUrl);
    if (safeLogoUrl !== '#') {
      return `<img src="${safeLogoUrl}" width="${width}" height="${width}" alt="${logoAlt}" style="display: block; border-radius: 12px;" />`;
    }
  }

  // Inline SVG logo fallback for email compatibility
  return `<svg width="${width}" height="${width}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display: block;">
        <!-- Shield background -->
        <path d="M50 5 L85 20 L85 45 Q85 75 50 95 Q15 75 15 45 L15 20 Z" fill="url(#grad)" stroke="#0f172a" stroke-width="2"/>
        <!-- Gradient definition -->
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#334155;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#1e293b;stop-opacity:1" />
            </linearGradient>
        </defs>
        <!-- OS Text -->
        <text x="50" y="58" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#ffffff" text-anchor="middle">OS</text>
    </svg>`;
}

function getDefaultLogoUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (!baseUrl || !baseUrl.startsWith('http')) return null;
  try {
    const parsed = new URL(baseUrl);
    const basePath =
      parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    const prefix = basePath ? `${parsed.origin}${basePath}` : parsed.origin;
    return `${prefix}/logo-compressed.png`;
  } catch {
    return `${baseUrl.replace(/\/$/, '')}/logo-compressed.png`;
  }
}

function getCheckIcon(size: number, color: string): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;">
    <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" fill="${color}"/>
</svg>`.trim();
}

function getWarningIcon(size: number, color: string): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" fill="${color}"/>
</svg>`.trim();
}

function getErrorIcon(size: number, color: string): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" fill="${color}"/>
</svg>`.trim();
}

function getInfoIcon(size: number, color: string): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" fill="${color}"/>
</svg>`.trim();
}
