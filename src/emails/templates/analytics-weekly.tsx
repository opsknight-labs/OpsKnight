import type { ReactNode } from 'react';
import {
  Button,
  Callout,
  BulletList,
  Content,
  EmailFooter,
  EmailLayout,
  HeaderBand,
  Heading,
  InfoTable,
  LinkFallback,
  Paragraph,
  Spacer,
  Strong,
  Table,
  TextLink,
  type InfoItem,
} from '../components';
import { FONT_BODY, FONT_DISPLAY, SURFACE, toneTokens } from '../tokens';

const L = SURFACE.light;
/** The product's chart teal (--chart-series-1). Emails can't read CSS variables. */
const CHART_TEAL = '#0d9488';
const BAR_MAX_PX = 88;

export type WeeklyDelta = {
  /** e.g. "33%" or "4 pts"; no sign, the arrow carries direction. */
  text: string;
  direction: 'up' | 'down' | 'flat';
  tone: 'good' | 'bad' | 'neutral';
};

export type WeeklyKpi = { label: string; value: string; delta?: WeeklyDelta | null; hint?: string };
export type WeeklyDay = { label: string; count: number };
export type WeeklyService = {
  name: string;
  incidents: string;
  delta?: WeeklyDelta | null;
  mttr: string;
  sla: string;
};
export type WeeklyResponder = { name: string; incidents: string; offHours: string; hours: string };

export type AnalyticsWeeklyEmailProps = {
  /** 'view': a saved view the user subscribed to. 'digest': the default summary everyone gets. */
  kind?: 'view' | 'digest';
  /** Where the recipient manages this email (digest: profile notifications). */
  manageUrl?: string;
  userName: string;
  viewName: string;
  viewUrl: string;
  /** e.g. "Mon Nov 10 – Sun Nov 16, 2026". */
  periodLabel: string;
  /** e.g. "Asia/Kolkata"; shown so day boundaries are unambiguous. */
  timeZone: string;
  kpis: WeeklyKpi[];
  /** What changed for the worse (or a single all-clear line). Already phrased. */
  highlights: string[];
  attention: boolean;
  days: WeeklyDay[];
  services: WeeklyService[];
  responders: WeeklyResponder[];
  health: InfoItem[];
};

const cellText = (size: number, weight = 400) => ({
  fontFamily: FONT_BODY,
  fontSize: `${size}px`,
  lineHeight: '1.4',
  fontWeight: weight,
});

function Delta({ delta }: { delta?: WeeklyDelta | null }) {
  if (!delta) return null;
  const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '–';
  const tone = delta.tone === 'good' ? 'ok' : delta.tone === 'bad' ? 'critical' : 'neutral';
  const word = delta.tone === 'good' ? ' better' : delta.tone === 'bad' ? ' worse' : '';
  return (
    <span
      className={tone === 'neutral' ? 'dm-text-muted' : `dm-ink-${tone}`}
      style={{ color: tone === 'neutral' ? L.muted_text : toneTokens(tone).ink, fontWeight: 600 }}
    >
      {`${arrow} ${delta.text}${word}`}
    </span>
  );
}

/** KPI tiles, two per row so they hold up on a 375px phone and in Outlook. */
function KpiGrid({ kpis }: { kpis: WeeklyKpi[] }) {
  const rows: WeeklyKpi[][] = [];
  for (let i = 0; i < kpis.length; i += 2) rows.push(kpis.slice(i, i + 2));
  return (
    <Table style={{ margin: '4px 0 20px' }}>
      {rows.map((row, r) => (
        <tr key={r}>
          {row.map((kpi, c) => (
            <td
              key={kpi.label}
              width="50%"
              valign="top"
              style={{
                width: '50%',
                padding: `0 ${c === 0 ? '6px' : '0'} 12px ${c === 1 ? '6px' : '0'}`,
              }}
            >
              <Table
                className="dm-bg-muted dm-border"
                bgcolor={L.muted}
                style={{
                  border: `1px solid ${L.border}`,
                  borderRadius: '10px',
                  backgroundColor: L.muted,
                }}
              >
                <tr>
                  <td style={{ padding: '14px 16px' }}>
                    <div
                      className="dm-text-muted"
                      style={{ ...cellText(12, 600), color: L.muted_text }}
                    >
                      {kpi.label}
                    </div>
                    <div
                      className="dm-text-heading"
                      style={{
                        fontFamily: FONT_DISPLAY,
                        fontSize: '26px',
                        lineHeight: '1.25',
                        fontWeight: 700,
                        color: L.heading,
                        margin: '4px 0 2px',
                      }}
                    >
                      {kpi.value}
                    </div>
                    <div style={cellText(12)}>
                      {kpi.delta ? <Delta delta={kpi.delta} /> : null}
                      {kpi.hint ? (
                        <span className="dm-text-muted" style={{ color: L.muted_text }}>
                          {kpi.delta ? ' · ' : ''}
                          {kpi.hint}
                        </span>
                      ) : null}
                      {!kpi.delta && !kpi.hint ? (
                        <span className="dm-text-muted" style={{ color: L.muted_text }}>
                          No comparison
                        </span>
                      ) : null}
                    </div>
                  </td>
                </tr>
              </Table>
            </td>
          ))}
          {row.length === 1 ? <td width="50%" /> : null}
        </tr>
      ))}
    </Table>
  );
}

/** Daily volume as table-cell bars: renders in Outlook, Gmail and Apple Mail without images. */
function DayBars({ days }: { days: WeeklyDay[] }) {
  const max = Math.max(1, ...days.map(day => day.count));
  return (
    <Table
      className="dm-border"
      style={{ margin: '4px 0 24px', border: `1px solid ${L.border}`, borderRadius: '10px' }}
    >
      <tr>
        {days.map(day => {
          const height = day.count ? Math.max(4, Math.round((day.count / max) * BAR_MAX_PX)) : 0;
          return (
            <td
              key={day.label}
              align="center"
              valign="bottom"
              height={BAR_MAX_PX + 36}
              style={{
                padding: '16px 4px 0',
                height: `${BAR_MAX_PX + 36}px`,
                verticalAlign: 'bottom',
              }}
            >
              <div
                className="dm-text-heading"
                style={{ ...cellText(12, 600), color: L.heading, marginBottom: '4px' }}
              >
                {day.count}
              </div>
              {height ? (
                <Table width="70%" align="center">
                  <tr>
                    <td
                      height={height}
                      bgcolor={CHART_TEAL}
                      style={{
                        height: `${height}px`,
                        lineHeight: `${height}px`,
                        fontSize: '1px',
                        backgroundColor: CHART_TEAL,
                        borderRadius: '4px 4px 0 0',
                      }}
                    >
                      &nbsp;
                    </td>
                  </tr>
                </Table>
              ) : null}
            </td>
          );
        })}
      </tr>
      <tr>
        {days.map(day => (
          <td
            key={day.label}
            align="center"
            className="dm-text-muted dm-border"
            style={{
              ...cellText(11, 600),
              color: L.muted_text,
              padding: '8px 2px 10px',
              borderTop: `1px solid ${L.border}`,
            }}
          >
            {day.label}
          </td>
        ))}
      </tr>
    </Table>
  );
}

/** Compact data table with a header row; numbers right-aligned. */
function DataTable({
  columns,
  rows,
}: {
  columns: Array<{ label: string; align?: 'left' | 'right'; width?: string }>;
  rows: ReactNode[][];
}) {
  const border = `1px solid ${L.border}`;
  return (
    <Table
      className="dm-border text-data-table"
      style={{ margin: '4px 0 24px', border, borderRadius: '10px' }}
    >
      <tr>
        {columns.map(column => (
          <td
            key={column.label}
            align={column.align ?? 'left'}
            width={column.width}
            className="dm-bg-muted dm-text-muted dm-border"
            bgcolor={L.muted}
            style={{
              ...cellText(12, 600),
              color: L.muted_text,
              backgroundColor: L.muted,
              // Tight horizontal padding and sentence-case headers keep four columns
              // inside a 375px phone (the card leaves ~315px for content).
              padding: '9px 8px',
              borderBottom: border,
            }}
          >
            {column.label}
          </td>
        ))}
      </tr>
      {rows.map((cells, r) => (
        <tr key={r}>
          {cells.map((cell, c) => (
            <td
              key={c}
              align={columns.at(c)?.align ?? 'left'}
              className={`dm-border ${c === 0 ? 'dm-text-heading' : 'dm-text-body'}`}
              style={{
                ...cellText(13, c === 0 ? 600 : 400),
                color: c === 0 ? L.heading : L.body,
                padding: '10px 8px',
                borderBottom: r === rows.length - 1 ? '0' : border,
                wordBreak: 'break-word',
              }}
            >
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </Table>
  );
}

export function AnalyticsWeeklyEmail({
  kind = 'view',
  manageUrl,
  userName,
  viewName,
  viewUrl,
  periodLabel,
  timeZone,
  kpis,
  highlights,
  attention,
  days,
  services,
  responders,
  health,
}: AnalyticsWeeklyEmailProps) {
  const incidents = kpis[0]?.value ?? '0';
  const digest = kind === 'digest';
  return (
    <EmailLayout
      title={`Weekly analytics: ${viewName}`}
      preview={`${viewName}: ${incidents} incidents last week. ${highlights[0] ?? ''}`}
      footer={
        <EmailFooter
          reason={
            digest
              ? 'You get this weekly summary because you have analytics access in'
              : 'You subscribed to this weekly analytics report in'
          }
        />
      }
    >
      <HeaderBand
        tone="neutral"
        eyebrow={digest ? 'Weekly summary' : 'Weekly analytics report'}
        title={viewName}
        subtitle={`${periodLabel} · ${timeZone}`}
      />
      <Content>
        <Paragraph>
          {digest ? (
            <>
              Hi {userName}, here is last week across the services and teams you can see, compared
              with the week before.
            </>
          ) : (
            <>
              Hi {userName}, here is last week for <Strong>{viewName}</Strong>, compared with the
              week before.
            </>
          )}
        </Paragraph>

        <Callout
          tone={attention ? 'elevated' : 'ok'}
          title={attention ? 'Needs attention' : 'All clear'}
        >
          <BulletList tone={attention ? 'elevated' : 'ok'} items={highlights} />
        </Callout>
        <Spacer height={8} />

        <Heading>Key metrics</Heading>
        <KpiGrid kpis={kpis} />

        <Heading>Incidents per day</Heading>
        <DayBars days={days} />

        <Heading>Services</Heading>
        {services.length ? (
          <DataTable
            columns={[
              { label: 'Service', width: '40%' },
              { label: 'Incidents', align: 'right' },
              { label: 'MTTR', align: 'right' },
              { label: 'SLA met', align: 'right' },
            ]}
            rows={services.map(service => [
              service.name,
              <>
                {service.incidents}
                {service.delta ? (
                  <>
                    <br />
                    <span style={cellText(11)}>
                      <Delta delta={service.delta} />
                    </span>
                  </>
                ) : null}
              </>,
              service.mttr,
              service.sla,
            ])}
          />
        ) : (
          <Paragraph muted>No incidents matched this view last week.</Paragraph>
        )}

        {responders.length ? (
          <>
            <Heading>On-call load</Heading>
            <DataTable
              columns={[
                { label: 'Responder', width: '40%' },
                { label: 'Incidents', align: 'right' },
                { label: 'Off-hours', align: 'right' },
                { label: 'Hours', align: 'right' },
              ]}
              rows={responders.map(person => [
                person.name,
                person.incidents,
                person.offHours,
                person.hours,
              ])}
            />
          </>
        ) : null}

        <Heading>Noise &amp; follow-through</Heading>
        <InfoTable items={health} />

        <Button href={viewUrl}>Open full report</Button>
        <LinkFallback href={viewUrl} />
        {digest ? (
          <Callout tone="neutral" surface="muted" title="About this email">
            You get this weekly summary because it is on by default for everyone with analytics
            access. It is separate from incident alert emails. To stop it, turn off{' '}
            <Strong>Weekly analytics summary</Strong> in{' '}
            {manageUrl ? (
              <TextLink href={manageUrl}>Profile → Notifications</TextLink>
            ) : (
              'Profile → Notifications'
            )}
            , or use Unsubscribe in your mail app.
          </Callout>
        ) : null}
        <Paragraph muted small>
          Off-hours counts incidents that reached each responder in their evening or overnight
          (their own timezone).
          {digest
            ? null
            : ' To stop this email, open the view and turn off Weekly email in the Views menu.'}
        </Paragraph>
      </Content>
    </EmailLayout>
  );
}

AnalyticsWeeklyEmail.PreviewProps = {
  userName: 'Sarah Chen',
  viewName: 'Payments, high urgency',
  viewUrl: 'https://app.opsknight.example/analytics?urgency=HIGH&from=2026-11-10&to=2026-11-16',
  periodLabel: 'Mon Nov 10 – Sun Nov 16, 2026',
  timeZone: 'America/New_York',
  attention: true,
  highlights: [
    'MTTR rose to 1h 12m from 58m (+24%).',
    'payments-api had 6 incidents, up from 3.',
    '2 postmortem action items are overdue.',
  ],
  kpis: [
    { label: 'Incidents', value: '12', delta: { text: '33%', direction: 'up', tone: 'bad' } },
    {
      label: 'MTTA (median)',
      value: '4m',
      delta: { text: '33%', direction: 'down', tone: 'good' },
      hint: 'p90 11m',
    },
    {
      label: 'MTTR (median)',
      value: '1h 12m',
      delta: { text: '24%', direction: 'up', tone: 'bad' },
      hint: 'p90 3h 5m',
    },
    { label: 'Ack SLA met', value: '92%', delta: { text: '4 pts', direction: 'up', tone: 'good' } },
    {
      label: 'Resolve SLA met',
      value: '83%',
      delta: { text: '7 pts', direction: 'down', tone: 'bad' },
    },
    {
      label: 'After hours',
      value: '42%',
      delta: { text: 'no change', direction: 'flat', tone: 'neutral' },
    },
  ],
  days: [
    { label: 'Mon', count: 2 },
    { label: 'Tue', count: 3 },
    { label: 'Wed', count: 1 },
    { label: 'Thu', count: 4 },
    { label: 'Fri', count: 1 },
    { label: 'Sat', count: 0 },
    { label: 'Sun', count: 1 },
  ],
  services: [
    {
      name: 'payments-api',
      incidents: '6',
      delta: { text: '100%', direction: 'up', tone: 'bad' },
      mttr: '1h 30m',
      sla: '80%',
    },
    {
      name: 'checkout-web',
      incidents: '4',
      delta: { text: 'no change', direction: 'flat', tone: 'neutral' },
      mttr: '48m',
      sla: '100%',
    },
    {
      name: 'ledger',
      incidents: '2',
      delta: { text: '100%', direction: 'up', tone: 'bad' },
      mttr: '2h 10m',
      sla: '50%',
    },
  ],
  responders: [
    { name: 'Priya Nair', incidents: '5', offHours: '2', hours: '6.5h' },
    { name: 'Marco Rossi', incidents: '4', offHours: '1', hours: '3.2h' },
    { name: 'Sarah Chen', incidents: '3', offHours: '0', hours: '2.0h' },
  ],
  health: [
    { label: 'Alerts per incident', value: '2.4' },
    { label: 'Auto-resolved', value: '18%' },
    { label: 'Postmortems published', value: '3 of 4 high-urgency incidents' },
    { label: 'Overdue action items', value: '2', highlight: true },
  ],
} satisfies AnalyticsWeeklyEmailProps;

export default AnalyticsWeeklyEmail;
