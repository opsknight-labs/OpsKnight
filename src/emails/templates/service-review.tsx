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
  Spacer,
} from '../components';
import type { EmailTone } from '../tokens';

export type ServiceReviewEntry = {
  name: string;
  /** BREACHED, AT_RISK, OK or null when the service has no SLO. */
  state: 'BREACHED' | 'AT_RISK' | 'OK' | null;
  slo: string;
  budget: string;
  trend: string;
  downtime: string;
  incidents: string;
  response: string;
  cost?: string | null;
  causes: string[];
};

export type ServiceReviewCompactRow = { name: string; summary: string };

export type ServiceReviewEmailProps = {
  recipientName: string;
  periodLabel: string;
  kind: 'digest' | 'summary';
  totals: {
    services: string;
    breached: string;
    atRisk: string;
    incidents: string;
    downtime: string;
    cost?: string | null;
  };
  expanded: ServiceReviewEntry[];
  compact: ServiceReviewCompactRow[];
  /** Rows beyond the compact cap, shown as one line. */
  hiddenCount?: number;
  reviewUrl?: string;
  manageUrl?: string;
  preview?: boolean;
};

const toneOf = (state: ServiceReviewEntry['state']): EmailTone =>
  state === 'BREACHED'
    ? 'critical'
    : state === 'AT_RISK'
      ? 'elevated'
      : state === 'OK'
        ? 'ok'
        : 'info';
const labelOf = (state: ServiceReviewEntry['state']) =>
  state === 'BREACHED'
    ? 'Budget exhausted'
    : state === 'AT_RISK'
      ? 'At risk'
      : state === 'OK'
        ? 'Within budget'
        : 'No SLO';

export function ServiceReviewEmail({
  recipientName,
  periodLabel,
  kind,
  totals,
  expanded,
  compact,
  hiddenCount = 0,
  reviewUrl,
  manageUrl,
  preview,
}: ServiceReviewEmailProps) {
  const headline = totals.breached !== '0' ? 'critical' : totals.atRisk !== '0' ? 'elevated' : 'ok';
  return (
    <EmailLayout
      title={`Service review: ${periodLabel}`}
      preview={`${periodLabel}: ${totals.services} services need a look, ${totals.breached} over budget`}
      footer={
        <EmailFooter reason="This monthly service review is sent by" settingsUrl={manageUrl} />
      }
    >
      <HeaderBand
        tone={headline}
        eyebrow="OpsKnight Service Review"
        title={kind === 'summary' ? 'Portfolio review' : 'Your monthly service review'}
        subtitle={periodLabel}
      />
      <Content>
        {preview ? <Badge tone="info">Preview</Badge> : null}
        <Paragraph>
          Hi {recipientName}, here is how {kind === 'summary' ? 'the portfolio' : 'your services'}{' '}
          did in {periodLabel}, ordered by what needs attention first.
        </Paragraph>
        <InfoTable
          tone={headline}
          items={[
            { label: 'Services to review', value: totals.services, highlight: true },
            { label: 'Error budget exhausted', value: totals.breached },
            { label: 'At risk', value: totals.atRisk },
            { label: 'Incidents', value: totals.incidents },
            { label: 'Downtime', value: totals.downtime },
            ...(totals.cost ? [{ label: 'Estimated cost', value: totals.cost }] : []),
          ]}
        />
        {expanded.map(entry => (
          <div key={entry.name}>
            <Spacer height={8} />
            <Heading>{entry.name}</Heading>
            <Badge tone={toneOf(entry.state)}>{labelOf(entry.state)}</Badge>
            <InfoTable
              tone={toneOf(entry.state)}
              items={[
                { label: 'SLO attainment', value: entry.slo, highlight: true },
                { label: 'Error budget', value: `${entry.budget} (${entry.trend})` },
                { label: 'Downtime', value: entry.downtime },
                { label: 'Incidents', value: entry.incidents },
                { label: 'MTTA / MTTR', value: entry.response },
                ...(entry.cost ? [{ label: 'Estimated cost', value: entry.cost }] : []),
              ]}
            />
            {entry.causes.length ? (
              <Callout tone={toneOf(entry.state)} surface="muted" title="Top causes">
                {entry.causes.join(' · ')}
              </Callout>
            ) : null}
          </div>
        ))}
        {compact.length ? (
          <>
            <Spacer height={8} />
            <Heading>Also this month</Heading>
            <BulletList items={compact.map(row => `${row.name}: ${row.summary}`)} />
            {hiddenCount > 0 ? <Paragraph>and {hiddenCount} more in OpsKnight.</Paragraph> : null}
          </>
        ) : null}
        {reviewUrl ? (
          <>
            <Button href={reviewUrl} tone={headline}>
              Open business services
            </Button>
            <LinkFallback href={reviewUrl} />
          </>
        ) : null}
      </Content>
    </EmailLayout>
  );
}

ServiceReviewEmail.PreviewProps = {
  recipientName: 'Sam',
  periodLabel: 'November 2026',
  kind: 'digest',
  totals: {
    services: '7',
    breached: '1',
    atRisk: '2',
    incidents: '9',
    downtime: '3.4 h',
    cost: '$12,400',
  },
  expanded: [
    {
      name: 'Checkout',
      state: 'BREACHED',
      slo: '99.62% vs 99.9% target',
      budget: '-38% remaining',
      trend: 'worsening',
      downtime: '163 min',
      incidents: '4',
      response: '3 min / 41 min',
      cost: '$9,800',
      causes: ['Payment provider timeouts', 'Bad deploy'],
    },
    {
      name: 'Search',
      state: 'AT_RISK',
      slo: '99.91% vs 99.9% target',
      budget: '12% remaining',
      trend: 'steady',
      downtime: '38 min',
      incidents: '2',
      response: '5 min / 22 min',
      causes: [],
    },
  ],
  compact: [
    { name: 'Notifications', summary: 'Within budget, 1 incident, 6 min downtime' },
    { name: 'Billing', summary: 'At risk, 1 incident, 20 min downtime' },
  ],
  hiddenCount: 0,
  reviewUrl: 'https://app.opsknight.example/services/business',
  manageUrl: 'https://app.opsknight.example/settings/profile',
} satisfies ServiceReviewEmailProps;

export default ServiceReviewEmail;
