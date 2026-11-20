import {
  Button,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  Heading,
  InfoTable,
  LinkFallback,
  Paragraph,
  Strong,
  type InfoItem,
} from '../components';

export type AnalyticsWeeklyEmailProps = {
  userName: string;
  viewName: string;
  viewUrl: string;
  /** e.g. "Nov 13 – Nov 20, 2026 (UTC)". */
  periodLabel: string;
  /** KPI rows, already formatted: "12 (was 9)". */
  kpis: InfoItem[];
  /** Top services by incident count, already formatted. */
  topServices: InfoItem[];
};

export function AnalyticsWeeklyEmail({
  userName,
  viewName,
  viewUrl,
  periodLabel,
  kpis,
  topServices,
}: AnalyticsWeeklyEmailProps) {
  return (
    <EmailLayout
      title={`Weekly analytics: ${viewName}`}
      preview={`${viewName}: ${kpis[0]?.value ?? ''} in the last 7 days`}
      footer={<EmailFooter reason="You subscribed to this weekly analytics report in" />}
    >
      <HeaderBand
        tone="info"
        eyebrow="Weekly analytics"
        title={viewName}
        subtitle={periodLabel}
      />
      <Content>
        <Paragraph>
          Hi {userName}, here is how <Strong>{viewName}</Strong> performed over the last 7 days,
          compared with the 7 days before.
        </Paragraph>
        <InfoTable tone="info" items={kpis} />
        <Heading>Top services</Heading>
        {topServices.length ? (
          <InfoTable tone="info" items={topServices} />
        ) : (
          <Paragraph>No incidents matched this view in the last 7 days.</Paragraph>
        )}
        <Button href={viewUrl} tone="info">
          Open analytics
        </Button>
        <LinkFallback href={viewUrl} />
        <Paragraph>
          To stop this email, open the view and turn off Weekly email in the Views menu.
        </Paragraph>
      </Content>
    </EmailLayout>
  );
}

AnalyticsWeeklyEmail.PreviewProps = {
  userName: 'Sarah Chen',
  viewName: 'Payments, high urgency',
  viewUrl: 'https://app.opsknight.example/analytics?urgency=HIGH&range=7d',
  periodLabel: 'Nov 13 – Nov 20, 2026 (UTC)',
  kpis: [
    { label: 'Incidents', value: '12 (was 9)', highlight: true },
    { label: 'MTTA (median)', value: '4m (was 6m)' },
    { label: 'MTTR (median)', value: '1h 12m (was 58m)' },
    { label: 'Ack SLA met', value: '92% (was 88%)' },
    { label: 'Resolve SLA met', value: '83% (was 90%)' },
  ],
  topServices: [
    { label: 'payments-api', value: '6 incidents (was 3)' },
    { label: 'checkout-web', value: '4 incidents (was 4)' },
    { label: 'ledger', value: '2 incidents (was 1)' },
  ],
} satisfies AnalyticsWeeklyEmailProps;

export default AnalyticsWeeklyEmail;
