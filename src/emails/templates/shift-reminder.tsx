import {
  Badge,
  BulletList,
  Button,
  Callout,
  Content,
  EmailFooter,
  EmailLayout,
  Heading,
  HeaderBand,
  InfoTable,
  LinkFallback,
  Paragraph,
  Strong,
  type InfoItem,
} from '../components';

export type ShiftReminderEmailProps = {
  userName: string;
  scheduleName: string;
  scheduleUrl: string;
  minutesUntilStart: number;
  details: InfoItem[];
};

export const RESPONDER_CHECKLIST = [
  'Verify your phone/SMS and mobile push notifications are unmuted.',
  'Review active incidents or maintenance windows before taking over.',
  'Coordinate with outgoing responders if any handoff context is pending.',
];

export function ShiftReminderEmail({
  userName,
  scheduleName,
  scheduleUrl,
  minutesUntilStart,
  details,
}: ShiftReminderEmailProps) {
  return (
    <EmailLayout
      title={`Upcoming On-Call Shift: ${scheduleName}`}
      preview={`Your on-call shift for ${scheduleName} starts in ~${minutesUntilStart} minute(s).`}
      footer={<EmailFooter />}
    >
      <HeaderBand
        tone="shift"
        eyebrow="On-call schedule"
        title="Upcoming On-Call Shift"
        subtitle={`Schedule: ${scheduleName}`}
      />
      <Content>
        <Badge tone="shift">Upcoming on-call</Badge>
        <Heading>Hi {userName}, your on-call shift is starting soon!</Heading>
        <Paragraph>
          You are scheduled to go on-call for <Strong>{scheduleName}</Strong> in approximately{' '}
          <Strong>{`${minutesUntilStart} minute(s)`}</Strong>. Please ensure your notification
          channels are active and you are prepared to respond to alerts.
        </Paragraph>
        <InfoTable items={details} tone="shift" />
        <Callout tone="shift" title="Responder Checklist">
          <BulletList items={RESPONDER_CHECKLIST} tone="shift" />
        </Callout>
        <Button href={scheduleUrl} tone="shift">
          View On-Call Schedule
        </Button>
        <LinkFallback href={scheduleUrl} />
      </Content>
    </EmailLayout>
  );
}

ShiftReminderEmail.PreviewProps = {
  userName: 'Sarah Chen',
  scheduleName: 'Primary Tier-1 SRE',
  scheduleUrl: 'https://app.opsknight.example/schedules/sched-123',
  minutesUntilStart: 60,
  details: [
    { label: 'Schedule', value: 'Primary Tier-1 SRE', highlight: true },
    { label: 'Starts In', value: '~60 minute(s)' },
    { label: 'Shift Start', value: 'Nov 5, 2026, 2:00 PM (America/New_York)' },
    { label: 'Shift End', value: 'Nov 5, 2026, 10:00 PM (America/New_York)' },
    { label: 'Duration', value: '8 hour(s)' },
  ],
} satisfies ShiftReminderEmailProps;

export default ShiftReminderEmail;
