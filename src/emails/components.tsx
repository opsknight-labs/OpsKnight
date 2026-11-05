/**
 * OpsKnight email primitives.
 *
 * Rules that make these render in every client (Outlook Windows/Word, new Outlook,
 * Gmail web/apps, Apple Mail, Yahoo):
 * - Layout is tables only: no flex, grid, position or float.
 * - Every coloured surface sets both the `bgcolor` attribute (Outlook) and
 *   `background-color`; gradients are progressive enhancement via background-image.
 * - CTAs are bulletproof: a VML `v:roundrect` for Outlook, a padded `<a>` elsewhere.
 * - Images are absolute https PNGs with explicit width/height/alt (no SVG, no data: URIs).
 * - Anything that changes in dark mode carries a `dm-*` class (see styles.ts).
 */
import type { CSSProperties, ReactNode } from 'react';
import { Preview } from '@react-email/components';
import { OPSKNIGHT_BRAND_URL } from '../lib/brand';
import { RawHtml } from './render';
import { darkModeCss, layoutCss, outlookHeadHtml } from './styles';
import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  OUTLOOK_WIDTH,
  SURFACE,
  toneTokens,
  type EmailTone,
} from './tokens';
import { escapeHtml, OPSKNIGHT_LOGO_RATIO, opsKnightLogoUrl, safeHref } from './utils';

const L = SURFACE.light;

/** Inline style helper that allows mso-* and other email-only properties. */
const css = (value: Record<string, string | number>): CSSProperties => value as CSSProperties;

type TableProps = {
  children: ReactNode;
  width?: string | number;
  style?: CSSProperties;
  className?: string;
  align?: 'left' | 'center' | 'right';
  bgcolor?: string;
  /** Omit from the generated plain-text alternative. */
  skipInText?: boolean;
};

/** A presentation table with the attributes every email client expects. */
export function Table({
  children,
  width = '100%',
  style,
  className,
  align,
  bgcolor,
  skipInText,
}: TableProps) {
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      width={width}
      align={align}
      bgcolor={bgcolor}
      className={className}
      data-skip-in-text={skipInText ? 'true' : undefined}
      style={css({ borderCollapse: 'separate', msoTableLspace: '0pt', msoTableRspace: '0pt', ...(style as Record<string, string | number>) })}
    >
      <tbody>{children}</tbody>
    </table>
  );
}

// ─── Document ──────────────────────────────────────────────────────────────

export type BrandProps = {
  /** Brand name shown next to the logo. Defaults to OpsKnight. */
  name?: string;
  /** Absolute https logo URL. Defaults to the OpsKnight email logo. */
  logoUrl?: string;
  logoAlt?: string;
  /** Logo width / height; defaults to the OpsKnight asset ratio (or square for custom logos). */
  logoRatio?: number;
  href?: string;
};

export type EmailLayoutProps = {
  /** Inbox preview text (hidden preheader). */
  preview: string;
  title: string;
  footer: ReactNode;
  children: ReactNode;
};

/** Document shell: head, dark mode, Outlook ghost table, card and footer. */
export function EmailLayout({ preview, title, footer, children }: EmailLayoutProps) {
  return (
    <html
      lang="en"
      dir="ltr"
      {...{
        xmlns: 'http://www.w3.org/1999/xhtml',
        'xmlns:v': 'urn:schemas-microsoft-com:vml',
        'xmlns:o': 'urn:schemas-microsoft-com:office:office',
      }}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <title>{title}</title>
        <RawHtml html={outlookHeadHtml()} />
        <style dangerouslySetInnerHTML={{ __html: layoutCss() + darkModeCss() }} />
      </head>
      <body
        id="body"
        className="dm-bg-page"
        style={css({
          margin: 0,
          padding: 0,
          width: '100%',
          backgroundColor: L.page,
          fontFamily: FONT_BODY,
          color: L.body,
          WebkitFontSmoothing: 'antialiased',
        })}
      >
        <Preview>{preview}</Preview>
        <Table bgcolor={L.page} className="dm-bg-page" style={{ backgroundColor: L.page }}>
          <tr>
            <td
              align="center"
              className="mobile-outer-padding desktop-outer-padding"
              style={{ padding: '32px 16px' }}
            >
              <RawHtml
                html={`<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${OUTLOOK_WIDTH}" align="center"><tr><td><![endif]-->`}
              />
              <Table
                className="mobile-container desktop-container mso-container"
                align="center"
                style={{ maxWidth: `${OUTLOOK_WIDTH}px`, margin: '0 auto' }}
              >
                <tr>
                  <td>
                    <Table
                      bgcolor={L.card}
                      className="dm-bg-card mobile-card"
                      style={{
                        backgroundColor: L.card,
                        border: `1px solid ${L.border}`,
                        borderRadius: '14px',
                      }}
                    >
                      {children}
                    </Table>
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: '24px 8px 0' }}>{footer}</td>
                </tr>
              </Table>
              <RawHtml html="<!--[if mso]></td></tr></table><![endif]-->" />
            </td>
          </tr>
        </Table>
      </body>
    </html>
  );
}

/**
 * Logo + wordmark at the top of the header band. The logo sits on a white circular chip
 * so the red shield stays crisp on every status colour (including crimson), in dark mode
 * and under forced inversion. It is a light chip, never the forbidden dark box.
 */
function BrandMark({
  name = 'OpsKnight',
  logoUrl,
  logoAlt,
  logoRatio,
  href = OPSKNIGHT_BRAND_URL,
}: BrandProps) {
  const src = logoUrl ?? opsKnightLogoUrl();
  const ratio = logoRatio ?? (logoUrl ? 1 : OPSKNIGHT_LOGO_RATIO);
  const chip = 40;
  const height = 26;
  const width = Math.round(height * ratio);
  const link = safeHref(href);
  return (
    <Table width="auto" skipInText style={{ marginBottom: '22px' }}>
      <tr>
        {src ? (
          <td style={{ paddingRight: '12px', verticalAlign: 'middle' }}>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <Table width={chip}>
                <tr>
                  <td
                    align="center"
                    valign="middle"
                    width={chip}
                    height={chip}
                    bgcolor="#ffffff"
                    className="desktop-logo-chip"
                    style={{
                      width: `${chip}px`,
                      height: `${chip}px`,
                      backgroundColor: '#ffffff',
                      borderRadius: '999px',
                      textAlign: 'center',
                      verticalAlign: 'middle',
                    }}
                  >
                    <img
                      src={src}
                      width={width}
                      height={height}
                      alt={logoAlt ?? name}
                      className={ratio === OPSKNIGHT_LOGO_RATIO ? 'desktop-logo-img' : undefined}
                      style={{
                        display: 'inline-block',
                        width: `${width}px`,
                        height: `${height}px`,
                        border: 0,
                        verticalAlign: 'middle',
                      }}
                    />
                  </td>
                </tr>
              </Table>
            </a>
          </td>
        ) : null}
        <td style={{ verticalAlign: 'middle' }}>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="desktop-logo-name"
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: '#ffffff',
              textDecoration: 'none',
            }}
          >
            {name}
          </a>
        </td>
      </tr>
    </Table>
  );
}

// ─── Card sections ─────────────────────────────────────────────────────────

export type HeaderBandProps = {
  tone: EmailTone;
  /** Small uppercase label above the title, e.g. "Critical incident". */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Brand shown at the top of the band. Defaults to OpsKnight. */
  brand?: BrandProps;
};

/**
 * Status-coloured band at the top of the card: brand mark, eyebrow, title, subtitle.
 * Outlook gets the solid `deep` colour (bgcolor), everyone else the deep → base gradient.
 * White text stays readable on both.
 */
export function HeaderBand({ tone, eyebrow, title, subtitle, brand }: HeaderBandProps) {
  const t = toneTokens(tone);
  return (
    <tr>
      <td
        bgcolor={t.deep}
        className="mobile-header-padding desktop-header-padding"
        style={{
          backgroundColor: t.deep,
          backgroundImage: `linear-gradient(135deg, ${t.deep} 0%, ${t.base} 100%)`,
          padding: '28px 36px 30px',
          borderRadius: '13px 13px 0 0',
        }}
      >
        <BrandMark {...brand} />
        {eyebrow ? (
          <p
            style={css({
              margin: '0 0 10px',
              fontFamily: FONT_BODY,
              fontSize: '12px',
              lineHeight: '16px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#ffffff',
              opacity: 0.9,
            })}
          >
            {eyebrow}
          </p>
        ) : null}
        <h1
          className="mobile-font-large desktop-font-title"
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontSize: '26px',
            lineHeight: '1.25',
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: '#ffffff',
          }}
        >
          {title}
        </h1>
        {subtitle ? (
          <p
            style={{
              margin: '8px 0 0',
              fontFamily: FONT_BODY,
              fontSize: '14px',
              lineHeight: '1.5',
              fontWeight: 500,
              color: '#ffffff',
              opacity: 0.9,
            }}
          >
            {subtitle}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

/** Main padded content cell of the card. */
export function Content({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td
        className="mobile-padding desktop-padding dm-bg-card"
        bgcolor={L.card}
        style={{
          padding: '32px 36px',
          backgroundColor: L.card,
          fontFamily: FONT_BODY,
          borderRadius: '0 0 13px 13px',
        }}
      >
        {children}
      </td>
    </tr>
  );
}

// ─── Typography ────────────────────────────────────────────────────────────

export function Heading({ children }: { children: ReactNode }) {
  return (
    <h2
      className="dm-text-heading"
      style={{
        margin: '0 0 12px',
        fontFamily: FONT_DISPLAY,
        fontSize: '20px',
        lineHeight: '1.35',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: L.heading,
      }}
    >
      {children}
    </h2>
  );
}

export function Paragraph({
  children,
  muted = false,
  align,
  small = false,
}: {
  children: ReactNode;
  muted?: boolean;
  align?: 'left' | 'center';
  small?: boolean;
}) {
  return (
    <p
      className={`desktop-font-body ${muted ? 'dm-text-muted' : 'dm-text-body'}`}
      style={{
        margin: '0 0 16px',
        fontFamily: FONT_BODY,
        fontSize: small ? '13px' : '15px',
        lineHeight: '1.6',
        color: muted ? L.muted_text : L.body,
        textAlign: align,
      }}
    >
      {children}
    </p>
  );
}

export function Strong({ children }: { children: ReactNode }) {
  return (
    <strong className="dm-text-heading" style={{ color: L.heading, fontWeight: 600 }}>
      {children}
    </strong>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={safeHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      className="dm-link"
      style={{ color: L.link, textDecoration: 'underline', wordBreak: 'break-word' }}
    >
      {children}
    </a>
  );
}

export function Spacer({ height = 16 }: { height?: number }) {
  return (
    <Table>
      <tr>
        <td
          height={height}
          style={css({
            height: `${height}px`,
            lineHeight: `${height}px`,
            fontSize: `${height}px`,
            msoLineHeightRule: 'exactly',
          })}
        >
          &nbsp;
        </td>
      </tr>
    </Table>
  );
}

// ─── Components ────────────────────────────────────────────────────────────

/** Solid pill badge. A table cell, not inline-flex, so Outlook keeps the fill. */
export function Badge({ tone, children }: { tone: EmailTone; children: ReactNode }) {
  const fill = toneTokens(tone).button;
  return (
    <Table width="auto" style={{ marginBottom: '18px' }}>
      <tr>
        <td
          bgcolor={fill}
          style={css({
            backgroundColor: fill,
            borderRadius: '999px',
            padding: '6px 14px',
            fontFamily: FONT_BODY,
            fontSize: '12px',
            lineHeight: '16px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#ffffff',
            msoLineHeightRule: 'exactly',
          })}
        >
          {children}
        </td>
      </tr>
    </Table>
  );
}

/**
 * Bulletproof CTA: VML roundrect for Outlook desktop, padded link for everything else.
 * Both carry a solid fill, so the label is never white-on-white.
 */
export function Button({
  href,
  children,
  tone = 'neutral',
  align = 'center',
}: {
  href: string;
  children: string;
  tone?: EmailTone;
  align?: 'left' | 'center';
}) {
  const fill = toneTokens(tone).button;
  const url = safeHref(href);
  const width = Math.min(560, Math.max(220, Math.round(children.length * 9.5 + 64)));
  const vml =
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ` +
    `href="${escapeHtml(url)}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="18%" stroke="f" fillcolor="${fill}">` +
    `<w:anchorlock/><center style="color:#ffffff;font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:600;">${escapeHtml(children)}</center>` +
    `</v:roundrect><![endif]-->`;
  return (
    <Table width="100%" style={{ margin: '8px 0 24px' }}>
      <tr>
        <td align={align} className="mobile-button">
          <RawHtml html={vml} />
          <RawHtml html="<!--[if !mso]><!-->" />
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={css({
              display: 'inline-block',
              backgroundColor: fill,
              color: '#ffffff',
              fontFamily: FONT_BODY,
              fontSize: '16px',
              lineHeight: '20px',
              fontWeight: 600,
              textAlign: 'center',
              textDecoration: 'none',
              padding: '14px 28px',
              borderRadius: '10px',
              minWidth: '160px',
              msoPaddingAlt: '0',
            })}
          >
            {children}
          </a>
          <RawHtml html="<!--<![endif]-->" />
        </td>
      </tr>
    </Table>
  );
}

export type InfoItem = { label: string; value: ReactNode; highlight?: boolean };

/** Label / value table with a 4px status accent, zebra rows and dark-mode hooks. */
export function InfoTable({ items, tone = 'neutral' }: { items: InfoItem[]; tone?: EmailTone }) {
  return (
    <Table
      className={`dm-border dm-accent-${tone} text-data-table`}
      style={{
        margin: '4px 0 20px',
        border: `1px solid ${L.border}`,
        borderLeft: `4px solid ${toneTokens(tone).border}`,
        borderRadius: '10px',
      }}
    >
      {items.map((item, index) => {
        const even = index % 2 === 0;
        const background = even ? L.card : L.muted;
        const rowClass = even ? 'dm-info-row-even' : 'dm-info-row-odd';
        const last = index === items.length - 1;
        const cell = {
          padding: '11px 16px',
          fontFamily: FONT_BODY,
          borderBottom: last ? '0' : `1px solid ${L.border}`,
          verticalAlign: 'top' as const,
        };
        return (
          <tr key={`${item.label}-${index}`} style={{ backgroundColor: background }}>
            <td
              bgcolor={background}
              width="34%"
              className={`mobile-table-cell desktop-table-cell mobile-table-label dm-info-label ${rowClass}`}
              style={{ ...cell, width: '34%', fontSize: '13px', fontWeight: 600, color: L.muted_text }}
            >
              {item.label}
            </td>
            <td
              bgcolor={background}
              className={`mobile-table-cell desktop-table-cell dm-info-value ${rowClass}`}
              style={{
                ...cell,
                fontSize: '14px',
                color: L.body,
                fontWeight: item.highlight ? 600 : 400,
                wordBreak: 'break-word',
              }}
            >
              {item.value}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

/**
 * Tinted box with a 4px accent rule: alerts, tips, checklists, notices.
 * `surface="muted"` gives the neutral #f8fafc description card (AGENTS.md §6).
 */
export function Callout({
  tone = 'info',
  title,
  children,
  surface = 'tinted',
  preformatted = false,
}: {
  tone?: EmailTone;
  title?: string;
  children: ReactNode;
  surface?: 'tinted' | 'muted';
  preformatted?: boolean;
}) {
  const t = toneTokens(tone);
  const muted = surface === 'muted';
  const background = muted ? L.muted : t.soft;
  const bgClass = muted ? 'dm-bg-muted' : `dm-soft-${tone}`;
  const titleColor = muted ? L.muted_text : t.ink;
  const titleClass = muted ? 'dm-text-muted' : `dm-ink-${tone}`;
  return (
    <Table style={{ margin: '4px 0 20px' }}>
      <tr>
        <td
          bgcolor={background}
          className={`${bgClass} dm-accent-${tone} desktop-font-body`}
          style={{
            backgroundColor: background,
            borderLeft: `4px solid ${t.border}`,
            borderRadius: '8px',
            padding: '14px 18px',
            fontFamily: FONT_BODY,
          }}
        >
          {title ? (
            <p
              className={titleClass}
              style={css({
                margin: '0 0 6px',
                fontSize: '11px',
                lineHeight: '16px',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: titleColor,
              })}
            >
              {title}
            </p>
          ) : null}
          <div
            className={muted ? 'dm-text-body' : `dm-ink-${tone}`}
            style={{
              fontSize: '14px',
              lineHeight: '1.6',
              color: muted ? L.body : t.ink,
              whiteSpace: preformatted ? 'pre-wrap' : undefined,
              wordBreak: 'break-word',
            }}
          >
            {children}
          </div>
        </td>
      </tr>
    </Table>
  );
}

/** "Button not working?" plain link for clients that strip buttons or block VML. */
export function LinkFallback({ href }: { href: string }) {
  const url = safeHref(href);
  if (url === '#') return null;
  return (
    <Paragraph muted small>
      Button not working? Copy and paste this link into your browser:
      <br />
      <TextLink href={url}>{url}</TextLink>
    </Paragraph>
  );
}

/** Bulleted list rendered as a table so Outlook keeps the indentation. */
export function BulletList({ items, tone = 'neutral' }: { items: string[]; tone?: EmailTone }) {
  return (
    <Table>
      {items.map(item => (
        <tr key={item}>
          <td
            width={18}
            className={`dm-ink-${tone}`}
            style={{ verticalAlign: 'top', fontSize: '14px', lineHeight: '1.6', color: toneTokens(tone).ink }}
          >
            &bull;
          </td>
          <td
            className={`dm-ink-${tone}`}
            style={{ fontSize: '14px', lineHeight: '1.6', color: toneTokens(tone).ink, paddingBottom: '4px' }}
          >
            {item}
          </td>
        </tr>
      ))}
    </Table>
  );
}

/** Monospace value (event references, IDs). */
export function Code({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: FONT_MONO, fontSize: '13px' }}>{children}</span>;
}

// ─── Footers ───────────────────────────────────────────────────────────────

const footerText = {
  margin: '0 0 6px',
  fontFamily: FONT_BODY,
  fontSize: '12px',
  lineHeight: '1.6',
  color: L.muted_text,
  textAlign: 'center' as const,
};

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={safeHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      className="dm-text-muted"
      style={{ color: L.muted_text, textDecoration: 'underline' }}
    >
      {children}
    </a>
  );
}

/** Footer for product notifications (incidents, schedules, account and security emails). */
export function EmailFooter({
  settingsUrl,
  unsubscribeUrl,
  reason = 'This is an automated notification from',
}: {
  settingsUrl?: string;
  unsubscribeUrl?: string;
  reason?: string;
}) {
  const links = [
    settingsUrl && safeHref(settingsUrl) !== '#' ? (
      <FooterLink key="settings" href={settingsUrl}>
        Notification settings
      </FooterLink>
    ) : null,
    unsubscribeUrl && safeHref(unsubscribeUrl) !== '#' ? (
      <FooterLink key="unsubscribe" href={unsubscribeUrl}>
        Unsubscribe from these emails
      </FooterLink>
    ) : null,
  ].filter(Boolean);
  return (
    <Table>
      <tr>
        <td>
          <p className="dm-text-muted" style={footerText}>
            {reason}{' '}
            <a
              href={OPSKNIGHT_BRAND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="dm-text-brand"
              style={{ color: L.heading, fontWeight: 700, textDecoration: 'none' }}
            >
              OpsKnight
            </a>{' '}
            Incident Management.
          </p>
          <p className="dm-text-muted" style={footerText}>
            <a
              href={OPSKNIGHT_BRAND_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="dm-text-muted"
              style={{ color: L.muted_text, textDecoration: 'none' }}
            >
              OpsKnight
            </a>{' '}
            &bull; Open-Source Incident Response
          </p>
          {links.length ? (
            <p className="dm-text-muted" style={{ ...footerText, margin: '8px 0 0' }}>
              {links.map((link, index) => (
                <span key={index}>
                  {index > 0 ? '  ·  ' : null}
                  {link}
                </span>
              ))}
            </p>
          ) : null}
        </td>
      </tr>
    </Table>
  );
}

/** Footer for status-page subscriber emails: reason, unsubscribe, "Powered by OpsKnight". */
export function SubscriberFooter({
  pageName,
  unsubscribeUrl,
}: {
  pageName: string;
  unsubscribeUrl?: string;
}) {
  const logo = opsKnightLogoUrl();
  return (
    <Table>
      <tr>
        <td>
          <p className="dm-text-muted" style={footerText}>
            You received this email because you are subscribed to{' '}
            <strong className="dm-text-heading" style={{ color: L.heading }}>
              {pageName}
            </strong>{' '}
            updates.
          </p>
          {unsubscribeUrl ? (
            <p className="dm-text-muted" style={{ ...footerText, margin: '0 0 18px' }}>
              <FooterLink href={unsubscribeUrl}>Unsubscribe from updates</FooterLink>
            </p>
          ) : null}
          <Table width="auto" align="center">
            <tr>
              <td
                className="dm-text-muted"
                style={css({
                  paddingRight: '8px',
                  verticalAlign: 'middle',
                  fontFamily: FONT_BODY,
                  fontSize: '11px',
                  fontWeight: 600,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: L.muted_text,
                })}
              >
                Powered by
              </td>
              {logo ? (
                <td style={{ paddingRight: '6px', verticalAlign: 'middle' }}>
                  <a href={OPSKNIGHT_BRAND_URL} target="_blank" rel="noopener noreferrer">
                    <img
                      src={logo}
                      width={18}
                      height={20}
                      alt="OpsKnight"
                      style={{ display: 'block', width: '18px', height: '20px', border: 0 }}
                    />
                  </a>
                </td>
              ) : null}
              <td style={{ verticalAlign: 'middle' }}>
                <a
                  href={OPSKNIGHT_BRAND_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dm-text-brand"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: '14px',
                    fontWeight: 700,
                    color: L.heading,
                    textDecoration: 'none',
                  }}
                >
                  OpsKnight
                </a>
              </td>
            </tr>
          </Table>
        </td>
      </tr>
    </Table>
  );
}
