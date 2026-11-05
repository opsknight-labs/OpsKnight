import { FONT_DISPLAY, SURFACE, toneTokens } from '../tokens';
import {
  Badge,
  Button,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  InfoTable,
  LinkFallback,
  Paragraph,
  Table,
} from '../components';

export type SlaAlertEmailProps = {
  breached: boolean;
  /** "ACK" or "RESOLVE". */
  breachType: string;
  incidentTitle: string;
  serviceName: string;
  urgency: string;
  targetMinutes: number;
  remainingMinutes: number;
  incidentUrl: string;
  detectedAt: string;
};

export function SlaAlertEmail({
  breached,
  breachType,
  incidentTitle,
  serviceName,
  urgency,
  targetMinutes,
  remainingMinutes,
  incidentUrl,
  detectedAt,
}: SlaAlertEmailProps) {
  const tone = breached ? 'critical' : 'elevated';
  const label = `SLA ${breachType} ${breached ? 'Breached' : 'Warning'}`;
  return (
    <EmailLayout
      title={`${label}: ${incidentTitle}`}
      preview={
        breached
          ? `${serviceName}: "${incidentTitle}" breached its ${targetMinutes} minute ${breachType} SLA.`
          : `${serviceName}: "${incidentTitle}" has ${remainingMinutes} minute(s) before an ${breachType} SLA breach.`
      }
      footer={<EmailFooter reason="This is an automated SLA alert from" />}
    >
      <HeaderBand
        tone={tone}
        eyebrow="Action required"
        title={label}
        subtitle={`Service: ${serviceName}`}
      />
      <Content>
        <Badge tone={tone}>{breached ? 'Breached' : 'Approaching breach'}</Badge>
        <Table style={{ margin: '0 0 18px' }}>
          <tr>
            <td align="center">
              <p
                className={`dm-ink-${tone}`}
                style={{
                  margin: 0,
                  fontFamily: FONT_DISPLAY,
                  fontSize: '36px',
                  lineHeight: '1.1',
                  fontWeight: 800,
                  color: toneTokens(tone).button,
                }}
              >
                {breached ? 'BREACHED' : `${remainingMinutes} min`}
              </p>
              <p
                className="dm-text-muted"
                style={{ margin: '6px 0 0', fontSize: '13px', color: SURFACE.light.muted_text }}
              >
                {breached ? 'SLA status' : 'Time remaining'}
              </p>
            </td>
          </tr>
        </Table>
        <Heading>{incidentTitle}</Heading>
        <Paragraph>
          {breached
            ? 'This incident has exceeded its SLA target deadline. Immediate triage and resolution are required.'
            : 'This incident is approaching its SLA limit. Please acknowledge or resolve it immediately to avoid a breach.'}
        </Paragraph>
        <InfoTable
          tone={tone}
          items={[
            { label: 'Service', value: serviceName, highlight: true },
            { label: 'Urgency', value: urgency },
            { label: 'Target', value: `${targetMinutes} min (${breachType})` },
            { label: 'Detected', value: detectedAt },
          ]}
        />
        <Button href={incidentUrl} tone={tone}>
          View Incident
        </Button>
        <LinkFallback href={incidentUrl} />
      </Content>
    </EmailLayout>
  );
}

SlaAlertEmail.PreviewProps = {
  breached: false,
  breachType: 'ACK',
  incidentTitle: 'Payment Gateway Connection Timeout',
  serviceName: 'Checkout & Payments',
  urgency: 'HIGH',
  targetMinutes: 15,
  remainingMinutes: 4,
  incidentUrl: 'https://app.opsknight.example/incidents/inc-12345',
  detectedAt: 'Thu, 05 Nov 2026 10:11:00 GMT',
} satisfies SlaAlertEmailProps;

export default SlaAlertEmail;
