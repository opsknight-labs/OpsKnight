import { FONT_BODY, SURFACE, type EmailTone } from '../tokens';
import {
  Badge,
  Button,
  Callout,
  Content,
  EmailLayout,
  HeaderBand,
  LinkFallback,
  SubscriberFooter,
  Table,
} from '../components';
import { escapeHtml } from '../utils';

const L = SURFACE.light;

export type AnnouncementType = 'INCIDENT' | 'MAINTENANCE' | 'UPDATE' | 'WARNING' | 'INFO';

export function announcementPresentation(type: string): { label: string; tone: EmailTone } {
  switch (type) {
    case 'INCIDENT':
      return { label: 'Incident', tone: 'critical' };
    case 'MAINTENANCE':
      return { label: 'Maintenance', tone: 'info' };
    case 'UPDATE':
      return { label: 'Update', tone: 'ok' };
    case 'WARNING':
      return { label: 'Warning', tone: 'elevated' };
    default:
      return { label: 'Information', tone: 'neutral' };
  }
}

/**
 * Per-recipient time fragments. Announcement fan-out renders the email once and
 * substitutes `{{start_time}}`, `{{end_time_section}}` and `{{posted_at_section}}`
 * per subscriber (notification-control-plane), so the optional rows are produced
 * here with the same styling as the template.
 */
const timeRowStyle = `margin:6px 0 0;font-family:${FONT_BODY.replace(/"/g, "'")};font-size:14px;line-height:1.5;color:${L.muted_text};`;

export function announcementEndTimeSection(endFormatted: string): string {
  return `<p class="dm-text-muted" style="${timeRowStyle}"><strong>End:</strong> ${escapeHtml(endFormatted)}</p>`;
}

export function announcementPostedAtSection(postedFormatted: string): string {
  return `<p class="dm-text-muted" style="${timeRowStyle}font-style:italic;">Posted on ${escapeHtml(postedFormatted)}</p>`;
}

export type StatusAnnouncementEmailProps = {
  pageName: string;
  logoUrl?: string;
  statusPageUrl: string;
  type: string;
  title: string;
  message: string;
  /** Usually `{{start_time}}`. */
  startTime: string;
  /** Raw per-recipient fragments (usually the `{{…_section}}` placeholders). */
  endTimeSectionHtml?: string;
  postedAtSectionHtml?: string;
  unsubscribeUrl?: string;
};

export function StatusAnnouncementEmail({
  pageName,
  logoUrl,
  statusPageUrl,
  type,
  title,
  message,
  startTime,
  endTimeSectionHtml,
  postedAtSectionHtml,
  unsubscribeUrl,
}: StatusAnnouncementEmailProps) {
  const { label, tone } = announcementPresentation(type);
  return (
    <EmailLayout
      title={`${label}: ${title}`}
      preview={`${pageName} · ${label}: ${title}`}
      footer={<SubscriberFooter pageName={pageName} unsubscribeUrl={unsubscribeUrl} />}
    >
      <HeaderBand
        tone={tone}
        brand={{ name: pageName, logoUrl, href: statusPageUrl }}
        eyebrow="Announcement"
        title={label}
        subtitle={title}
      />
      <Content>
        <Badge tone={tone}>{label}</Badge>
        <Callout tone={tone} title={`${label} Details`} preformatted>
          {message}
        </Callout>
        <Table style={{ margin: '0 0 20px' }}>
          <tr>
            <td style={{ fontFamily: FONT_BODY }}>
              <p
                className="dm-text-muted"
                style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: L.muted_text }}
              >
                <strong>Start:</strong> {startTime}
              </p>
              {endTimeSectionHtml ? (
                <div dangerouslySetInnerHTML={{ __html: endTimeSectionHtml }} />
              ) : null}
              {postedAtSectionHtml ? (
                <div dangerouslySetInnerHTML={{ __html: postedAtSectionHtml }} />
              ) : null}
            </td>
          </tr>
        </Table>
        <Button href={statusPageUrl} tone={tone}>
          View Status Page
        </Button>
        <LinkFallback href={statusPageUrl} />
      </Content>
    </EmailLayout>
  );
}

StatusAnnouncementEmail.PreviewProps = {
  pageName: 'Acme Cloud',
  statusPageUrl: 'https://status.acme.example',
  type: 'MAINTENANCE',
  title: 'Database maintenance window',
  message:
    'We will upgrade the primary database cluster. Brief read-only periods of up to 2 minutes are expected.',
  startTime: 'Nov 8, 2026, 02:00 UTC',
  endTimeSectionHtml: announcementEndTimeSection('Nov 8, 2026, 03:00 UTC'),
  postedAtSectionHtml: announcementPostedAtSection('Nov 5, 2026, 09:00 UTC'),
  unsubscribeUrl: 'https://status.acme.example/unsubscribe/preview-token',
} satisfies StatusAnnouncementEmailProps;

export default StatusAnnouncementEmail;
