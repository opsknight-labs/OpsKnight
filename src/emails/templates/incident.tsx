import {
  Badge,
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  InfoTable,
  LinkFallback,
  Paragraph,
  type InfoItem,
} from '../components';
import type { EmailTone } from '../tokens';

export type IncidentEventType = 'triggered' | 'acknowledged' | 'resolved' | 'updated';

export type IncidentPresentation = {
  header: string;
  label: string;
  message: string;
  tone: EmailTone;
  cta: string;
};

/** Event + urgency → wording and status tone (AGENTS.md "Status Color Semantics"). */
export function incidentPresentation(
  eventType: IncidentEventType,
  urgency: string,
  eventMessage?: string
): IncidentPresentation {
  const escalation = eventMessage?.match(/Escalation Level\s+(\d+)/i);
  if (escalation) {
    return {
      header: `Escalation Level ${escalation[1]}`,
      label: `Escalation Level ${escalation[1]}`,
      message: `This incident has reached escalation level ${escalation[1]} and requires responder attention.`,
      tone: 'critical',
      cta: 'View Incident',
    };
  }
  if (eventType === 'resolved') {
    return {
      header: 'Incident Resolved',
      label: 'Resolved',
      message: 'This incident has been resolved.',
      tone: 'ok',
      cta: 'View Resolution',
    };
  }
  if (eventType === 'acknowledged') {
    return {
      header: 'Incident Acknowledged',
      label: 'Acknowledged',
      message: 'This incident has been acknowledged and is being actively worked.',
      tone: 'elevated',
      cta: 'View Incident',
    };
  }
  if (eventType === 'updated') {
    return {
      header: 'Incident Updated',
      label: 'Updated',
      message: 'Incident details have been updated. Review the latest committed update below.',
      tone: 'info',
      cta: 'View Incident',
    };
  }
  const isHigh = urgency === 'HIGH';
  const isMedium = urgency === 'MEDIUM';
  return {
    header: isHigh
      ? 'Critical Incident Alert'
      : isMedium
        ? 'Elevated Incident Alert'
        : 'Incident Notification',
    label: isHigh ? 'Critical Incident' : isMedium ? 'Elevated Incident' : 'New Incident',
    message: 'A new incident has been reported. Review the details and take action.',
    tone: isHigh ? 'critical' : isMedium ? 'elevated' : 'info',
    cta: 'View Incident',
  };
}

export type IncidentEmailProps = {
  presentation: IncidentPresentation;
  title: string;
  serviceName: string;
  description?: string | null;
  /** Event context (escalation step, update note); omitted when it only echoes the title. */
  context?: string;
  details: InfoItem[];
  incidentUrl: string;
  settingsUrl?: string;
};

export function IncidentEmail({
  presentation,
  title,
  serviceName,
  description,
  context,
  details,
  incidentUrl,
  settingsUrl,
}: IncidentEmailProps) {
  const { tone } = presentation;
  return (
    <EmailLayout
      title={`${presentation.header}: ${title}`}
      preview={`${presentation.label} · ${serviceName}: ${title}`}
      footer={<EmailFooter settingsUrl={settingsUrl} />}
    >
      <HeaderBand
        tone={tone}
        eyebrow={presentation.header}
        title={title}
        subtitle={`Service: ${serviceName}`}
      />
      <Content>
        <Badge tone={tone}>{presentation.label}</Badge>
        <Paragraph>{presentation.message}</Paragraph>
        {context ? (
          <Callout tone={tone} title="Latest update">
            {context}
          </Callout>
        ) : null}
        <InfoTable items={details} tone={tone} />
        {description ? (
          <Callout tone={tone} surface="muted" title="Incident Description" preformatted>
            {description}
          </Callout>
        ) : null}
        <Button href={incidentUrl} tone={tone}>
          {presentation.cta}
        </Button>
        <LinkFallback href={incidentUrl} />
      </Content>
    </EmailLayout>
  );
}

/** Preview fixture for `npm run email:dev`. */
IncidentEmail.PreviewProps = {
  presentation: incidentPresentation('triggered', 'HIGH'),
  title: 'Payment Gateway Connection Timeout',
  serviceName: 'Checkout & Payments',
  description:
    'PostgreSQL connection pool exhausted on ap-south-1 cluster.\n\n• p99 latency 4.2s\n• 31% of checkout requests failing',
  context: 'Escalation Level 2: Paged Secondary On-Call',
  details: [
    { label: 'Service', value: 'Checkout & Payments', highlight: true },
    { label: 'Status', value: 'OPEN' },
    { label: 'Urgency', value: 'HIGH' },
    { label: 'Assignee', value: 'Alex Rivera' },
    { label: 'Created', value: 'Nov 5, 2026, 10:00 AM' },
  ],
  incidentUrl: 'https://app.opsknight.example/incidents/inc-12345',
  settingsUrl: 'https://app.opsknight.example/settings/notifications',
} satisfies IncidentEmailProps;

export default IncidentEmail;
