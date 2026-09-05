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
  logoWidth?: number;
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
 * Fully optimized for both mobile and laptop/desktop screens
 */
export function EmailContainer(content: string, styles: EmailStyles = {}): string {
  const backgroundColor = styles.backgroundColor || '#ffffff';
  const outerBackground = '#f8fafc';

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
        html, body { margin: 0 auto !important; padding: 0 !important; height: 100% !important; width: 100% !important; }
        * { -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; box-sizing: border-box; }
        table, td { mso-table-lspace: 0pt !important; mso-table-rspace: 0pt !important; }
        table { border-spacing: 0 !important; border-collapse: collapse !important; table-layout: fixed !important; margin: 0 auto !important; }
        img { -ms-interpolation-mode: bicubic; }
        /* Mobile Optimization (<= 640px) */
        @media only screen and (max-width: 640px) {
            .mobile-outer-padding { padding: 12px 8px !important; }
            .mobile-container { width: 100% !important; max-width: 100% !important; border-radius: 12px !important; }
            .mobile-header-padding { padding: 26px 20px !important; }
            .mobile-text-center { text-align: center !important; }
            .mobile-full-width { width: 100% !important; max-width: 100% !important; }
            .mobile-font-large { font-size: 22px !important; line-height: 1.3 !important; }
            .mobile-font-medium { font-size: 15px !important; }
            .mobile-font-small { font-size: 13px !important; }
            .mobile-button { width: 100% !important; display: block !important; }
            .mobile-button a { width: 100% !important; box-sizing: border-box !important; min-width: 0 !important; padding: 14px 16px !important; font-size: 15px !important; }
            .mobile-hide { display: none !important; }
            .mobile-logo-name { font-size: 20px !important; }
            .mobile-logo-img { width: 44px !important; height: 44px !important; }
            .mobile-spacing { margin: 20px 0 !important; }
            .mobile-table-cell { padding: 10px 12px !important; font-size: 13px !important; }
            .mobile-table-label { width: 38% !important; }
        }

        /* Large Displays & Desktop Screens (>= 1024px) */
        @media only screen and (min-width: 1024px) {
            .desktop-container { max-width: 860px !important; width: 90% !important; border-radius: 20px !important; }
            .desktop-outer-padding { padding: 48px 32px !important; }
            .desktop-header-padding { padding: 44px 50px !important; }
            .desktop-padding { padding: 40px 50px !important; }
            .desktop-font-title { font-size: 30px !important; }
            .desktop-font-body { font-size: 15px !important; line-height: 1.65 !important; }
            .desktop-logo-img { width: 60px !important; height: 60px !important; }
            .desktop-logo-name { font-size: 26px !important; }
            .desktop-table-cell { padding: 15px 24px !important; font-size: 15px !important; }
            .desktop-button a { padding: 16px 40px !important; font-size: 16px !important; min-width: 260px !important; }
        }

        /* 27-inch Displays & Quad-HD Monitors (>= 1440px) */
        @media only screen and (min-width: 1440px) {
            .desktop-container { max-width: 1080px !important; width: 88% !important; border-radius: 24px !important; }
            .desktop-outer-padding { padding: 60px 48px !important; }
            .desktop-header-padding { padding: 54px 64px !important; }
            .desktop-padding { padding: 50px 64px !important; }
            .desktop-font-title { font-size: 34px !important; }
            .desktop-font-body { font-size: 16px !important; line-height: 1.75 !important; }
            .desktop-logo-img { width: 72px !important; height: 72px !important; }
            .desktop-logo-name { font-size: 30px !important; }
            .desktop-table-cell { padding: 18px 32px !important; font-size: 16px !important; }
            .desktop-button a { padding: 18px 52px !important; font-size: 17px !important; min-width: 300px !important; }
        }

        /* Ultrawide & 4K Displays (>= 1920px) */
        @media only screen and (min-width: 1920px) {
            .desktop-container { max-width: 1180px !important; width: 85% !important; border-radius: 28px !important; }
            .desktop-outer-padding { padding: 72px 64px !important; }
            .desktop-header-padding { padding: 60px 76px !important; }
            .desktop-padding { padding: 56px 76px !important; }
            .desktop-font-title { font-size: 36px !important; }
            .desktop-logo-img { width: 76px !important; height: 76px !important; }
            .desktop-logo-name { font-size: 32px !important; }
            .desktop-table-cell { padding: 20px 36px !important; font-size: 16px !important; }
            .desktop-button a { padding: 20px 56px !important; font-size: 18px !important; min-width: 340px !important; }
        }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${outerBackground}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; color: #1e293b;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${outerBackground}; table-layout: fixed;">
        <tr>
            <td align="center" class="mobile-outer-padding desktop-outer-padding" style="padding: 32px 16px;">
                <!--[if mso]>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="640" align="center">
                <tr>
                <td>
                <![endif]-->
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="mobile-container desktop-container" style="max-width: 640px; margin: 0 auto; background-color: ${backgroundColor}; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -1px rgba(0, 0, 0, 0.04); border: 1px solid #e2e8f0;">
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
 * Branded email header with OpsKnight logo and gradient
 * Mobile-responsive with flexible layout
 */
export function EmailHeader(title: string, subtitle?: string, styles: EmailStyles = {}): string {
  const headerGradient =
    styles.headerGradient || 'linear-gradient(135deg, #1e293b 0%, #334155 40%, #475569 100%)';
  const brandName = escapeHtml(styles.brandName || 'OpsKnight');
  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : undefined;
  const logoWidth = styles.logoWidth || 56;

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td class="mobile-header-padding desktop-header-padding" style="background: ${headerGradient}; padding: 38px 36px; text-align: left; position: relative;">
            <!-- Brand Bar -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 22px 0;">
                <tr>
                    <td style="padding-right: 14px; vertical-align: middle;">
                        ${getOpsKnightLogo(logoWidth, styles)}
                    </td>
                    <td style="vertical-align: middle;">
                        <span class="mobile-logo-name desktop-logo-name" style="font-size: 24px; font-weight: 800; color: #ffffff !important; letter-spacing: -0.01em; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap;">${brandName}</span>
                    </td>
                </tr>
            </table>
            
            <!-- Title -->
            <h1 class="mobile-font-large desktop-font-title" style="margin: 0 0 ${safeSubtitle ? '8px' : '0'} 0; color: #ffffff !important; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3;">
                ${safeTitle}
            </h1>
            
            ${
              safeSubtitle
                ? `
            <!-- Subtitle -->
            <p class="mobile-font-small desktop-font-body" style="margin: 0; color: rgba(255, 255, 255, 0.9) !important; font-size: 14px; font-weight: 500; line-height: 1.4;">
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
        <td class="mobile-padding desktop-padding" style="padding: 32px 32px; background: #ffffff;">
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
  type: 'success' | 'warning' | 'error' | 'info' | 'schedule' = 'info'
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
    schedule: {
      bg: '#7c3aed',
      text: '#ffffff',
      icon: getCalendarIcon(16, '#ffffff'),
      shadow: 'rgba(124, 58, 237, 0.2)',
    },
  };

  const color =
    type === 'success'
      ? colors.success
      : type === 'warning'
        ? colors.warning
        : type === 'error'
          ? colors.error
          : type === 'schedule'
            ? colors.schedule
            : colors.info;
  const safeStatus = escapeHtml(status);

  return `
<div style="display: inline-flex; align-items: center; gap: 10px; background: ${color.bg}; color: ${color.text}; padding: 12px 24px; border-radius: 999px; font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; box-shadow: 0 4px 14px ${color.shadow}, 0 0 0 1px rgba(255, 255, 255, 0.1) inset;">
    <span style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);"></span>
    <span>${safeStatus}</span>
</div>`.trim();
}

/**
 * Call-to-action button with OpsKnight branded gradient
 * Optimized for mobile with large touch targets
 */
export function EmailButton(text: string, url: string, styles: EmailStyles = {}): string {
  const buttonBackground =
    styles.buttonBackground || 'linear-gradient(135deg, #1e293b 0%, #334155 100%)';
  const buttonShadow = styles.buttonShadow || '0 8px 20px rgba(30, 41, 59, 0.25)';
  const buttonTextColor = styles.buttonTextColor || '#ffffff';
  const safeText = escapeHtml(text);
  const safeUrl = sanitizeUrl(url);

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" class="mobile-full-width mobile-spacing" style="margin: 32px auto; width: auto;">
    <tr>
        <td class="mobile-button desktop-button" style="border-radius: 10px; background: ${buttonBackground}; text-align: center; box-shadow: ${buttonShadow};">
            <a href="${safeUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; color: ${buttonTextColor} !important; text-decoration: none; font-weight: 600; font-size: 15px; line-height: 1.5; border-radius: 10px; min-width: 220px; text-align: center;">
                ${safeText}
            </a>
        </td>
    </tr>
</table>`.trim();
}

/**
 * Information card with label and value
 * Fluid responsive widths optimized for mobile and desktop screens
 */
export function InfoCard(
  items: Array<{ label: string; value: string; highlight?: boolean }>,
  styles: { accentColor?: string } = {}
): string {
  const accentColor = styles.accentColor || '#e2e8f0';
  const rows = items
    .map(
      (item, idx) => `
        <tr style="${idx % 2 === 1 ? 'background: #f8fafc;' : 'background: #ffffff;'}">
            <td class="mobile-table-cell desktop-table-cell mobile-table-label" style="padding: 12px 18px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; color: #64748b; width: 34%; min-width: 90px; vertical-align: middle;">
                ${escapeHtml(item.label)}
            </td>
            <td class="mobile-table-cell desktop-table-cell" style="padding: 12px 18px; border-bottom: 1px solid #e2e8f0; font-size: 14px; color: #1e293b; width: 66%; word-break: break-word; vertical-align: middle; ${item.highlight ? 'font-weight: 600;' : ''}">
                ${escapeHtml(item.value)}
            </td>
        </tr>
    `
    )
    .join('');

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; border-left: 4px solid ${accentColor}; margin: 20px 0;">
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

  let color;
  switch (type) {
    case 'success':
      color = colors.success;
      break;
    case 'warning':
      color = colors.warning;
      break;
    case 'error':
      color = colors.error;
      break;
    case 'info':
    default:
      color = colors.info;
      break;
  }
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

  return `
<div style="background: ${color.bg}; border-left: 4px solid ${color.border}; padding: 20px 22px; border-radius: 12px; margin: 20px 0;">
    <h3 style="margin: 0 0 10px 0; color: ${color.title}; font-size: 16px; font-weight: 700; letter-spacing: -0.01em;">
        ${safeTitle}
    </h3>
    <p style="margin: 0; color: ${color.text}; font-size: 14px; line-height: 1.6;">
        ${safeMessage}
    </p>
</div>`.trim();
}

/**
 * Dedicated OpsKnight product promotion card
 * @deprecated Dedicated promo card is removed to keep transactional alert emails clean, subtle, and focused.
 */
export function OpsKnightPromoCard(): string {
  return '';
}

/**
 * Footer with OpsKnight branding and notification context
 * Subtle, minimalist, and elegant.
 */
export function EmailFooter(unsubscribeUrl?: string, settingsUrl?: string): string {
  const safeUnsubscribe = unsubscribeUrl ? sanitizeUrl(unsubscribeUrl) : undefined;
  const safeSettings = settingsUrl ? sanitizeUrl(settingsUrl) : undefined;

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td style="padding: 24px 32px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
            <p style="margin: 0 0 6px 0; color: #64748b; font-size: 13px; line-height: 1.5;">
                This is an automated notification from <strong style="color: #0f172a;">OpsKnight</strong> Incident Management.
            </p>
            <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
                OpsKnight &bull; Open-Source Incident Response
            </p>
            <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                ${
                  safeSettings && safeSettings !== '#'
                    ? `<a href="${safeSettings}" style="color: #64748b; text-decoration: underline; margin-right: 12px;">Notification Settings</a>`
                    : ''
                }
                ${
                  safeUnsubscribe && safeUnsubscribe !== '#'
                    ? `<a href="${safeUnsubscribe}" style="color: #64748b; text-decoration: underline;">Unsubscribe from these emails</a>`
                    : ''
                }
            </p>
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
  const logoWidth = styles.logoWidth || 52;
  const brandLogo = getOpsKnightLogo(logoWidth, {
    ...styles,
    logoAlt,
  });
  const safeTitle = escapeHtml(title);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : undefined;

  return `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
    <tr>
        <td class="mobile-header-padding desktop-header-padding" style="background: ${headerGradient}; padding: 36px 32px; text-align: left; position: relative;">
            <!-- Brand Header -->
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-bottom: 20px;">
                <tr>
                    <td align="left" valign="middle">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                                <td style="padding-right: 12px; vertical-align: middle;">
                                    ${brandLogo}
                                </td>
                                <td style="vertical-align: middle;">
                                    <span class="mobile-logo-name desktop-logo-name" style="font-size: 22px; font-weight: 700; color: #ffffff !important; letter-spacing: -0.01em; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; white-space: nowrap;">
                                        ${displayName}
                                    </span>
                                </td>
                            </tr>
                        </table>
                    </td>
                    <td align="right" valign="middle" class="mobile-hide" style="color: rgba(255, 255, 255, 0.7); font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;">
                        Powered by OpsKnight
                    </td>
                </tr>
            </table>

            <!-- Organization Name (The Sender) -->
            <h1 class="mobile-font-large desktop-font-title" style="margin: 0 0 10px 0; color: #ffffff !important; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.3;">
                ${displayName}
            </h1>
            
            <!-- Update Type Badge -->
            <div style="margin-bottom: 18px;">
                <span style="display: inline-block; padding: 5px 12px; background: rgba(255, 255, 255, 0.16); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 8px; color: #ffffff !important; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;">
                    ${safeTitle}
                </span>
            </div>

            ${
              safeSubtitle
                ? `
            <p class="mobile-font-medium desktop-font-body" style="margin: 0; color: rgba(255, 255, 255, 0.9) !important; font-size: 15px; font-weight: 500; line-height: 1.45;">
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
        <td style="padding: 28px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
            <p style="margin: 0 0 12px 0; color: #64748b; font-size: 13px; line-height: 1.6;">
                You received this email because you are subscribed to <strong>${safePageName}</strong> updates.
            </p>
            
            <p style="margin: 0 0 24px 0; font-size: 13px;">
                <a href="${safeUnsubscribe}" style="color: #64748b; text-decoration: underline;">Unsubscribe from updates</a>
            </p>

            <!-- OpsKnight Marketing -->
            <div>
                <p style="margin: 0 0 6px 0; color: #94a3b8; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;">
                    Powered by
                </p>
                <a href="https://opsknight.com" target="_blank" rel="noopener noreferrer" style="text-decoration: none; display: inline-block;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center">
                        <tr>
                            <td style="padding-right: 8px; vertical-align: middle;">
                                ${getOpsKnightLogo(22)}
                            </td>
                            <td style="vertical-align: middle;">
                                <span style="color: #0f172a; font-size: 15px; font-weight: 700; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: -0.01em;">OpsKnight</span>
                            </td>
                        </tr>
                    </table>
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
      return `<img src="${safeLogoUrl}" width="${width}" height="${width}" alt="${logoAlt}" class="mobile-logo-img desktop-logo-img" style="display: block; width: ${width}px; height: ${width}px; max-width: 100%; border: 0; outline: none; text-decoration: none;" />`;
    }
  }

  // Authentic OpsKnight shield & headset knight vector fallback
  return `
<svg width="${width}" height="${width}" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" class="mobile-logo-img desktop-logo-img" style="display: block; width: ${width}px; height: ${width}px;">
    <defs>
        <linearGradient id="shieldGrad" x1="50" y1="5" x2="50" y2="95" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ef4444"/>
            <stop offset="100%" stop-color="#b91c1c"/>
        </linearGradient>
    </defs>
    <path d="M50 6 C68 15 84 18 86 28 C88 52 74 76 50 94 C26 76 12 52 14 28 C16 18 32 15 50 6 Z" fill="url(#shieldGrad)" stroke="#ffffff" stroke-width="3"/>
    <path d="M34 46 C34 32 40 24 50 24 C60 24 66 32 66 46" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    <rect x="29" y="42" width="9" height="18" rx="4.5" fill="#ffffff"/>
    <rect x="62" y="42" width="9" height="18" rx="4.5" fill="#ffffff"/>
    <path d="M66 54 C66 62 58 65 52 65" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M38 73 L50 64 L62 73" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M50 64 L50 82" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
</svg>`.trim();
}

function getDefaultLogoUrl(): string | null {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL;
  if (!baseUrl || !baseUrl.startsWith('http')) return null;
  try {
    const parsed = new URL(baseUrl);
    const basePath =
      parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '';
    const prefix = basePath ? `${parsed.origin}${basePath}` : parsed.origin;
    return `${prefix}/logo.png`;
  } catch {
    return `${baseUrl.replace(/\/$/, '')}/logo.png`;
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

export function getCalendarIcon(size: number, color: string): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: inline-block; vertical-align: middle;">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" fill="${color}"/>
</svg>`.trim();
}
