import {
  Badge,
  Button,
  Callout,
  Content,
  EmailLayout,
  HeaderBand,
  Heading,
  LinkFallback,
  Paragraph,
  SubscriberFooter,
  TextLink,
} from '../components';
import { SURFACE, type EmailTone } from '../tokens';

export type StatusUpdatePresentation = { label: string; tone: EmailTone };

/** Subscriber-facing lifecycle label + tone for an incident or maintenance event. */
export function statusUpdatePresentation(eventType: string): StatusUpdatePresentation {
  switch (eventType) {
    case 'triggered':
      return { label: 'New Incident', tone: 'critical' };
    case 'acknowledged':
    case 'investigating':
      return { label: 'Investigating', tone: 'elevated' };
    case 'identified':
      return { label: 'Identified', tone: 'elevated' };
    case 'monitoring':
      return { label: 'Monitoring', tone: 'info' };
    case 'resolved':
      return { label: 'Resolved', tone: 'ok' };
    case 'completed':
      return { label: 'Maintenance Completed', tone: 'ok' };
    case 'scheduled':
      return { label: 'Maintenance Scheduled', tone: 'info' };
    case 'inprogress':
      return { label: 'In Progress', tone: 'elevated' };
    default:
      return { label: 'Update', tone: 'info' };
  }
}

export type StatusUpdateEmailProps = {
  pageName: string;
  logoUrl?: string;
  statusPageUrl: string;
  eventType: string;
  incidentTitle: string;
  /** Omitted when the page hides affected services. */
  serviceName?: string;
  /** Omitted when the page hides incident details. */
  description?: string;
  /** Pre-formatted "posted at" text; omitted when the page hides timestamps. */
  postedAt?: string;
  supportUrl?: string;
  /** Usually the per-recipient `{{unsubscribe_url}}` placeholder. */
  unsubscribeUrl?: string;
};

export function StatusUpdateEmail({
  pageName,
  logoUrl,
  statusPageUrl,
  eventType,
  incidentTitle,
  serviceName,
  description,
  postedAt,
  supportUrl,
  unsubscribeUrl,
}: StatusUpdateEmailProps) {
  const { label, tone } = statusUpdatePresentation(eventType);
  return (
    <EmailLayout
      title={`${label}: ${incidentTitle}`}
      preview={`${pageName} · ${label}: ${incidentTitle}`}
      footer={<SubscriberFooter pageName={pageName} unsubscribeUrl={unsubscribeUrl} />}
    >
      <HeaderBand
        tone={tone}
        brand={{ name: pageName, logoUrl, href: statusPageUrl }}
        eyebrow="Status update"
        title={label}
        subtitle={incidentTitle}
      />
      <Content>
        <Badge tone={tone}>{label}</Badge>
        {serviceName ? (
          <>
            <Paragraph muted small>
              Affecting service
            </Paragraph>
            <Heading>{serviceName}</Heading>
          </>
        ) : null}
        <Callout tone={tone} surface="muted" title="Update Details" preformatted>
          {description || 'Additional incident details are not published.'}
          {postedAt ? (
            <>
              <br />
              <br />
              <span className="dm-text-muted" style={{ fontSize: '13px', color: SURFACE.light.muted_text }}>
                Posted on {postedAt}
              </span>
            </>
          ) : null}
        </Callout>
        <Button href={statusPageUrl} tone={tone}>
          View Status Page
        </Button>
        <LinkFallback href={statusPageUrl} />
        {supportUrl ? (
          <Paragraph muted small align="center">
            Questions? <TextLink href={supportUrl}>Contact Support</TextLink>
          </Paragraph>
        ) : (
          <Paragraph muted small align="center">
            Contact support via your usual channels.
          </Paragraph>
        )}
      </Content>
    </EmailLayout>
  );
}

StatusUpdateEmail.PreviewProps = {
  pageName: 'Acme Cloud',
  statusPageUrl: 'https://status.acme.example',
  eventType: 'identified',
  incidentTitle: 'Elevated API error rates in eu-west-1',
  serviceName: 'Public API',
  description:
    'We have identified a faulty load balancer configuration and are rolling back the change.',
  postedAt: 'Nov 5, 2026, 10:42 UTC',
  supportUrl: 'mailto:support@acme.example',
  unsubscribeUrl: 'https://status.acme.example/unsubscribe/preview-token',
} satisfies StatusUpdateEmailProps;

export default StatusUpdateEmail;
