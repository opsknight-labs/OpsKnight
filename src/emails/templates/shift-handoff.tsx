import { FONT_BODY, SURFACE } from '../tokens';
import {
  Badge,
  Button,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  LinkFallback,
  Paragraph,
  Strong,
  Table,
  TextLink,
} from '../components';

const L = SURFACE.light;

export type HandoffIncident = { id: string; title: string; status: string; incidentUrl: string };

export type ShiftHandoffEmailProps = {
  userName: string;
  scheduleName: string;
  scheduleUrl: string;
  totalIncidents: number;
  incidents: HandoffIncident[];
  remainingCount: number;
};

function IncidentRow({ incident }: { incident: HandoffIncident }) {
  return (
    <Table style={{ marginBottom: '8px' }}>
      <tr>
        <td
          bgcolor={L.muted}
          className="dm-bg-muted"
          style={{
            backgroundColor: L.muted,
            border: `1px solid ${L.border}`,
            borderRadius: '8px',
            padding: '12px 14px',
            fontFamily: FONT_BODY,
          }}
        >
          <p
            className="dm-text-heading"
            style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: L.heading }}
          >
            {incident.title}
          </p>
          <p
            className="dm-text-muted"
            style={{ margin: '4px 0 0', fontSize: '12px', color: L.muted_text }}
          >
            Status: <strong>{incident.status}</strong> ·{' '}
            <TextLink href={incident.incidentUrl}>Open Incident →</TextLink>
          </p>
        </td>
      </tr>
    </Table>
  );
}

export function ShiftHandoffEmail({
  userName,
  scheduleName,
  scheduleUrl,
  totalIncidents,
  incidents,
  remainingCount,
}: ShiftHandoffEmailProps) {
  return (
    <EmailLayout
      title={`Shift Rotation Handoff: ${scheduleName}`}
      preview={`You are now on-call for ${scheduleName} with ${totalIncidents} active incident(s).`}
      footer={<EmailFooter />}
    >
      <HeaderBand
        tone="shift"
        eyebrow="On-call schedule"
        title="Shift Rotation Handoff"
        subtitle={`Schedule: ${scheduleName}`}
      />
      <Content>
        <Badge tone="shift">Shift handoff</Badge>
        <Heading>Hi {userName}, you are now On-Call</Heading>
        <Paragraph>
          Your on-call shift for <Strong>{scheduleName}</Strong> has started. The following{' '}
          <Strong>{`${totalIncidents} active incident(s)`}</Strong> have been automatically
          reassigned to you{remainingCount > 0 ? ` (showing top ${incidents.length})` : ''}:
        </Paragraph>
        {incidents.map(incident => (
          <IncidentRow key={incident.id} incident={incident} />
        ))}
        {remainingCount > 0 ? (
          <Table style={{ marginBottom: '8px' }}>
            <tr>
              <td
                align="center"
                className="dm-bg-muted"
                bgcolor={L.muted}
                style={{
                  backgroundColor: L.muted,
                  border: `1px dashed ${L.border}`,
                  borderRadius: '8px',
                  padding: '12px 14px',
                  fontFamily: FONT_BODY,
                  fontSize: '13px',
                  color: L.muted_text,
                }}
              >
                <span className="dm-text-muted">
                  {`+ ${remainingCount} more active incident${remainingCount === 1 ? '' : 's'} assigned to this shift.`}
                </span>
                <br />
                <TextLink href={scheduleUrl}>View all on schedule →</TextLink>
              </td>
            </tr>
          </Table>
        ) : null}
        <Button href={scheduleUrl} tone="shift">
          View Schedule &amp; Incidents
        </Button>
        <LinkFallback href={scheduleUrl} />
      </Content>
    </EmailLayout>
  );
}

ShiftHandoffEmail.PreviewProps = {
  userName: 'David Miller',
  scheduleName: 'Platform Infrastructure Rotation',
  scheduleUrl: 'https://app.opsknight.example/schedules/sched-456',
  totalIncidents: 7,
  incidents: [
    {
      id: 'inc-101',
      title: 'High CPU utilization on Redis cluster',
      status: 'ACKNOWLEDGED',
      incidentUrl: 'https://app.opsknight.example/incidents/inc-101',
    },
    {
      id: 'inc-102',
      title: 'Kafka Consumer Lag Spike',
      status: 'TRIGGERED',
      incidentUrl: 'https://app.opsknight.example/incidents/inc-102',
    },
  ],
  remainingCount: 5,
} satisfies ShiftHandoffEmailProps;

export default ShiftHandoffEmail;
