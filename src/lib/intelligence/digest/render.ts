import type { RateAnomalyRow, RecurringProblem, WeeklySummary } from '../insights/service';
import type { TeamBrief } from './team-brief';

export interface DigestContent {
  weekKey: string;
  weekly: WeeklySummary;
  recurring: readonly RecurringProblem[];
  anomalies: readonly RateAnomalyRow[];
  /** Open operations insights the recipient may read (already scoped and capped); empty hides the section. */
  opsInsights?: ReadonlyArray<{ scopeName: string; title: string; severity: string; url: string }>;
  opsInsightsUrl?: string;
  /** Weekly reliability brief per team of the recipient (already scoped and capped); empty hides it. */
  teamBriefs?: readonly TeamBrief[];
  insightsUrl: string;
  settingsUrl: string;
}

const MAX_ROWS = 5;

const ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ESCAPES.get(char) ?? char);
}

const count = (record: Record<string, number>, ...kinds: string[]) =>
  kinds.reduce(
    (sum, kind) => sum + (Object.entries(record).find(([key]) => key === kind)?.[1] ?? 0),
    0
  );

/**
 * The weekly digest email. It is built per recipient from data that person may already read, holds
 * counts, service names and masked titles only, and every value is escaped before it reaches HTML.
 */
export function renderDigestEmail(content: DigestContent): {
  subject: string;
  html: string;
  text: string;
} {
  const { weekly } = content;
  const helpfulRate =
    weekly.ratings > 0
      ? `${Math.round((weekly.helpfulRatings / weekly.ratings) * 100)}%`
      : 'no ratings yet';
  const stats: Array<[string, string]> = [
    ['Incidents analysed', String(weekly.incidentsAnalyzed)],
    ['Similar incidents found', String(count(weekly.findingsByKind, 'SIMILAR_INCIDENT'))],
    [
      'Possible causes found',
      String(count(weekly.findingsByKind, 'CHANGE_CORRELATION', 'PROBABLE_CAUSE')),
    ],
    ['Runbooks suggested', String(count(weekly.findingsByKind, 'RUNBOOK_RECOMMENDATION'))],
    ['Suggestions rated helpful', `${helpfulRate} (${weekly.ratings} ratings)`],
    ['Changes recorded', String(weekly.changesRecorded)],
  ];
  if (weekly.deadLetters > 0)
    stats.push(['Background items that gave up', String(weekly.deadLetters)]);

  const recurring = content.recurring.slice(0, MAX_ROWS);
  const anomalies = content.anomalies.slice(0, MAX_ROWS);
  const ops = (content.opsInsights ?? []).slice(0, MAX_ROWS);
  const teams = (content.teamBriefs ?? []).slice(0, MAX_ROWS);
  const severityLabel = (severity: string) =>
    severity === 'INFO' ? '' : ` [${severity.toLowerCase()}]`;
  const subject = `OpsKnight Intelligence weekly digest (${content.weekKey})`;

  const text = [
    subject,
    '',
    ...stats.map(([label, value]) => `${label}: ${value}`),
    '',
    recurring.length > 0 ? 'Recurring problems:' : 'No recurring problems this week.',
    ...recurring.map(
      row =>
        `- ${row.serviceName}: "${row.template}" x${row.occurrences}${row.hasRunbook ? '' : ' (no runbook)'}`
    ),
    '',
    anomalies.length > 0 ? 'Unusual incident rates:' : 'No unusual incident rates.',
    ...anomalies.map(
      row =>
        `- ${row.serviceName}: ${row.recent} in the last week (usual ${row.baselineWeekly.toFixed(1)})`
    ),
    '',
    ...(ops.length > 0
      ? [
          'Needs attention:',
          ...ops.map(
            row => `- ${row.scopeName}: ${row.title}${severityLabel(row.severity)} ${row.url}`
          ),
          ...(content.opsInsightsUrl ? [`All open insights: ${content.opsInsightsUrl}`] : []),
          '',
        ]
      : []),
    ...teams.flatMap(team => [
      `${team.teamName}: ${team.line}`,
      ...(team.phrasing ? [team.phrasing] : []),
      ...team.insights.map(
        row => `- ${row.scopeName}: ${row.title}${severityLabel(row.severity)} ${row.url}`
      ),
      `Team page: ${team.url}`,
      '',
    ]),
    `Open Insights: ${content.insightsUrl}`,
    `Change or stop this email: ${content.settingsUrl}`,
    'This digest only reports; it never changes incidents or paging.',
  ].join('\n');

  const cell = 'padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;';
  const rows = stats
    .map(
      ([label, value]) =>
        `<tr><td style="${cell}color:#4b5563">${escapeHtml(label)}</td><td style="${cell}font-weight:600">${escapeHtml(value)}</td></tr>`
    )
    .join('');
  const list = (items: string[], empty: string) =>
    items.length > 0
      ? `<ul style="padding-left:18px;font-size:14px">${items.join('')}</ul>`
      : `<p style="font-size:14px;color:#4b5563">${escapeHtml(empty)}</p>`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#111827;max-width:640px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;margin:0 0 4px">Intelligence weekly digest</h1>
<p style="margin:0 0 16px;color:#4b5563;font-size:14px">${escapeHtml(content.weekKey)} · last ${weekly.windowDays} days</p>
<table role="presentation" style="border-collapse:collapse;width:100%">${rows}</table>
<h2 style="font-size:16px;margin:20px 0 4px">Recurring problems</h2>
${list(
  recurring.map(
    row =>
      `<li><strong>${escapeHtml(row.serviceName)}</strong>: “${escapeHtml(row.template)}” × ${row.occurrences}${row.hasRunbook ? '' : ' <em>(no runbook)</em>'}</li>`
  ),
  'No recurring problems this week.'
)}
<h2 style="font-size:16px;margin:20px 0 4px">Unusual incident rates</h2>
${list(
  anomalies.map(
    row =>
      `<li><strong>${escapeHtml(row.serviceName)}</strong>: ${row.recent} in the last week (usual ${escapeHtml(row.baselineWeekly.toFixed(1))})</li>`
  ),
  'No unusual incident rates.'
)}
${
  ops.length > 0
    ? `<h2 style="font-size:16px;margin:20px 0 4px">Needs attention</h2>
${list(
  ops.map(
    row =>
      `<li><a href="${escapeHtml(row.url)}" style="color:#1d4ed8">${escapeHtml(row.scopeName)}</a>: ${escapeHtml(row.title)}${escapeHtml(severityLabel(row.severity))}</li>`
  ),
  ''
)}${content.opsInsightsUrl ? `<p style="margin:4px 0 0;font-size:14px"><a href="${escapeHtml(content.opsInsightsUrl)}" style="color:#1d4ed8">All open insights</a></p>` : ''}`
    : ''
}
${teams
  .map(
    team => `<h2 style="font-size:16px;margin:20px 0 4px"><a href="${escapeHtml(team.url)}" style="color:#111827">${escapeHtml(team.teamName)}</a></h2>
<p style="margin:0;font-size:14px">${escapeHtml(team.line)}</p>${team.phrasing ? `<p style="margin:4px 0 0;font-size:14px;color:#4b5563">${escapeHtml(team.phrasing)}</p>` : ''}
${
  team.insights.length > 0
    ? list(
        team.insights.map(
          row =>
            `<li><a href="${escapeHtml(row.url)}" style="color:#1d4ed8">${escapeHtml(row.scopeName)}</a>: ${escapeHtml(row.title)}${escapeHtml(severityLabel(row.severity))}</li>`
        ),
        ''
      )
    : ''
}`
  )
  .join('')}
<p style="margin:20px 0 0"><a href="${escapeHtml(content.insightsUrl)}" style="color:#1d4ed8">Open Insights</a></p>
<p style="margin:16px 0 0;font-size:12px;color:#6b7280">This digest only reports; it never changes incidents or paging. <a href="${escapeHtml(content.settingsUrl)}" style="color:#6b7280">Change or stop this email</a>.</p>
</body></html>`;
  return { subject, html, text };
}
