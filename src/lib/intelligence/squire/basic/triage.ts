import 'server-only';
import type { IncidentStatus, IncidentUrgency, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { pageByUrgency, URGENCY_MOST_FIRST } from '@/lib/incidents/urgency-order';
import { projectIncidentSlaState } from '@/lib/incident-sla/state';
import { formatTimeMinutesMs } from '@/lib/time-format';
import { redactSecrets } from '../../ai/redact';
import { incidentRef } from '../../incident-ux/explain';
import { searchProductDocs } from '../docs';
import { formatWhen, type CollectBasicEvidence } from './reads';

/** "My website is down", "customers say checkout is not working", "the site is slow", "I got an alert". */
const PROBLEM =
  /\b(?:down|broken|not working|isn'?t working|stopped working|slow|failing|crashed|crashing|outage|unavailable|erroring|timing out|can'?t (?:log ?in|pay|checkout|load)|something(?:'?s| is) (?:broken|wrong))\b/;
const SUBJECT =
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed pattern over a short chat message; alternations are bounded words, no nested quantifiers on the same text
  /\b(?:my|our|the) (?:website|site|app|application|api|checkout|server|service|system|platform|page)\b|\b(?:customers?|users?|clients?) (?:say|says|are|is|report\w*|complain\w*|can'?t|cannot|affected|impacted|seeing)\b|^something(?:'?s| is) (?:broken|wrong|down)|\b(?:i|we) (?:got|received|have|get) (?:an? )?(?:alert|page|notification|text|call)\b/;
const IMPACT = /\b(?:customers?|users?|clients?) (?:are |is )?(?:affected|impacted)\b/;
const LISTING = /^(?:show|list|find|which|how many|count|what (?:services|incidents))\b/;

export function isTriageQuestion(text: string): boolean {
  const lower = text.toLowerCase().replace(/[’]/g, "'");
  if (LISTING.test(lower) || /\b(?:overdue|action items?|postmortems?)\b/.test(lower)) return false;
  return (
    /^what (?:should|do|can) (?:i|we) do[\s?!.]*$/.test(lower) ||
    IMPACT.test(lower) ||
    (SUBJECT.test(lower) &&
      (PROBLEM.test(lower) || /\balert|page|notification|text|call\b/.test(lower)))
  );
}

/** Words that describe the situation rather than name the affected thing. */
const FILLER = new Set(
  'customers customer users user clients client say says saying said report reports reported reporting complain complaining is are was not working work works what do does did how can cant cannot my our the this that and for with have has got get gotten received alert alerts page pages notification text call phone down broken slow failing crashed outage unavailable erroring something wrong site website app application system platform server service api affected impacted seeing please help why just it its im ive on in of to a an i we you are'.split(
    ' '
  )
);

function subjectTerms(text: string): string[] {
  return [
    ...new Set(
      (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
        word => word.length >= 3 && !FILLER.has(word)
      )
    ),
  ].slice(0, 4);
}

const safe = (value: string | null | undefined, limit = 120) =>
  redactSecrets(value ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, limit)
    .replace(/[\\`*_{}[\]()<>|#]/g, '\\$&');

const summary = (row: {
  id: string;
  title: string;
  status: string;
  urgency: string;
  createdAt: Date;
}) => ({
  id: row.id,
  title: row.title,
  status: row.status,
  urgency: row.urgency,
  createdAt: row.createdAt,
});
const OPEN_STATUSES: IncidentStatus[] = ['OPEN', 'ACKNOWLEDGED'];
const urgencyWord = (urgency: IncidentUrgency) => urgency.toLowerCase();

/** The current picture for someone who does not know where to look: what is open, what fits, what to do. */
export async function triageAnswer(
  actor: AuthorizationActor,
  text: string,
  timeZone: string,
  collect?: CollectBasicEvidence
): Promise<string> {
  const base: Prisma.IncidentWhereInput = {
    AND: [incidentReadWhere(actor), { status: { in: OPEN_STATUSES } }],
  };
  const terms = subjectTerms(text);
  const fit: Prisma.IncidentWhereInput | null = terms.length
    ? {
        AND: [
          base,
          {
            OR: terms.flatMap(term => [
              { title: { contains: term, mode: 'insensitive' as const } },
              { service: { name: { contains: term, mode: 'insensitive' as const } } },
            ]),
          },
        ],
      }
    : null;
  const select = {
    id: true,
    title: true,
    status: true,
    urgency: true,
    createdAt: true,
    service: { select: { name: true } },
  } satisfies Prisma.IncidentSelect;
  const top = (where: Prisma.IncidentWhereInput, take: number) =>
    pageByUrgency({
      take,
      count: urgency => prisma.incident.count({ where: { AND: [where, { urgency }] } }),
      fetch: (urgency, skip, limit) =>
        prisma.incident.findMany({
          where: { AND: [where, { urgency }] },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip,
          take: limit,
          select,
        }),
    });
  const [byUrgency, matched, recent] = await Promise.all([
    prisma.incident.groupBy({ by: ['urgency'], where: base, _count: { id: true } }),
    fit ? top(fit, 3) : Promise.resolve([]),
    top(base, 5),
  ]);
  const total = byUrgency.reduce((sum, row) => sum + row._count.id, 0);
  const line = (row: (typeof recent)[number]) => {
    collect?.({ kind: 'incident', id: row.id, label: row.title, data: row });
    return `- ${incidentRef(row.id)} **${safe(row.title)}** — ${safe(row.service.name)}, ${row.status.toLowerCase()}, ${urgencyWord(row.urgency)} urgency; opened ${formatWhen(row.createdAt, timeZone)}.\n  /incidents/${row.id}`;
  };
  const counts = URGENCY_MOST_FIRST.map(
    urgency =>
      `${byUrgency.find(row => row.urgency === urgency)?._count.id ?? 0} ${urgencyWord(urgency)}`
  ).join(', ');
  const subject = terms.join(' ');
  const picture =
    total === 0
      ? 'I can see no open incidents right now. That does not prove everything is fine: an alert may not have reached OpsKnight yet, or the incident may belong to a team you cannot read.'
      : [
          `**${total} incident${total === 1 ? ' is' : 's are'} open** (${counts} urgency).`,
          matched.length
            ? `These look like what you describe (they mention "${safe(subject)}"):\n${matched.map(line).join('\n')}`
            : `${terms.length ? `None of the open incidents mention "${safe(subject)}". ` : ''}The most urgent open incidents:\n${recent.map(line).join('\n')}`,
        ].join('\n\n');
  return [
    '## Here is the current picture',
    picture,
    '### What to do next',
    [
      matched.length || total > 0
        ? '1. Open the incident that fits and **acknowledge** it, so the team knows someone owns it.'
        : '1. Create an incident at /incidents/create, choosing the affected service and urgency, so the team can respond.',
      '2. Tell the team: add a note on the incident, and ask “Who is on call?” to reach the right person.',
      '3. If customers are affected, post an update on your status page.',
      '4. Ask “What should I do?” on the incident for suggested checks.',
    ].join('\n'),
  ].join('\n\n');
}

/** "Which incidents breached SLA / are overdue / missed their ack target". */
export const SLA_BREACH_QUESTION =
  /\b(?:(?:breach\w*|overdue|missed|miss|past|over|violat\w*|late)\b.*\b(?:sla|slas|ack\w* target|resolv\w* target|targets?)|(?:sla|slas)\b.*\b(?:breach\w*|overdue|missed|violat\w*|late)|(?:overdue|late) incidents?|incidents? (?:that )?(?:are )?(?:overdue|late))\b/;

const SCAN_PER_URGENCY = 200;

export async function slaBreachAnswer(
  actor: AuthorizationActor,
  timeZone: string,
  now: Date,
  collect?: CollectBasicEvidence
): Promise<string> {
  const where: Prisma.IncidentWhereInput = {
    AND: [
      incidentReadWhere(actor),
      {
        status: { in: OPEN_STATUSES },
        slaAckTargetMs: { not: null },
        slaResolveTargetMs: { not: null },
      },
    ],
  };
  const breached: Array<{
    row: {
      id: string;
      title: string;
      urgency: IncidentUrgency;
      status: IncidentStatus;
      createdAt: Date;
      service: { name: string };
    };
    phases: string[];
  }> = [];
  let capped = false;
  for (const urgency of URGENCY_MOST_FIRST) {
    const rows = await prisma.incident.findMany({
      where: { AND: [where, { urgency }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: SCAN_PER_URGENCY,
      select: {
        id: true,
        title: true,
        urgency: true,
        status: true,
        createdAt: true,
        acknowledgedAt: true,
        slaFirstAcknowledgedAt: true,
        resolvedAt: true,
        resolutionKind: true,
        slaAckTargetMs: true,
        slaResolveTargetMs: true,
        slaTargetSource: true,
        slaTargetCapturedAt: true,
        slaPausedMs: true,
        slaPauseStartedAt: true,
        slaAckElapsedMs: true,
        slaResolveElapsedMs: true,
        slaPolicyId: true,
        slaPolicyVersion: true,
        slaPolicyRule: true,
        slaPriorityAtCapture: true,
        service: { select: { name: true } },
      },
    });
    capped ||= rows.length === SCAN_PER_URGENCY;
    for (const row of rows) {
      const sla = projectIncidentSlaState(row, { now });
      if (!sla.valid) continue;
      const phases = (['ack', 'resolve'] as const).flatMap(name => {
        // eslint-disable-next-line security/detect-object-injection -- name is the literal 'ack' | 'resolve'
        const phase = sla[name];
        if (phase.status !== 'BREACHED') return [];
        const late = formatTimeMinutesMs(Math.max(0, phase.elapsedMs - phase.targetMs));
        const label = name === 'ack' ? 'acknowledge' : 'resolve';
        return [
          `${label} target missed by ${late} (target ${formatTimeMinutesMs(phase.targetMs)})`,
        ];
      });
      if (phases.length) breached.push({ row, phases });
    }
  }
  const shown = breached.slice(0, 5);
  return [
    '## Incidents past their SLA target',
    breached.length === 0
      ? `No open incident you can read is past its acknowledge or resolve target${capped ? ' among the oldest I checked' : ''}. Incidents without a captured SLA target are not counted.`
      : `**${breached.length} open incident${breached.length === 1 ? ' is' : 's are'} past a target**, highest urgency first${breached.length > shown.length ? `; showing ${shown.length}` : ''}.`,
    ...shown.map(({ row, phases }) => {
      // Not the whole row: its SLA clock fields are BigInts, which evidence cannot serialise.
      collect?.({ kind: 'incident', id: row.id, label: row.title, data: summary(row) });
      return `- ${incidentRef(row.id)} **${safe(row.title)}** — ${safe(row.service.name)}, ${row.status.toLowerCase()}, ${urgencyWord(row.urgency)} urgency; opened ${formatWhen(row.createdAt, timeZone)}. ${phases.join('; ')}.\n  /incidents/${row.id}`;
    }),
    breached.length
      ? 'Acknowledging stops the acknowledge clock; resolving stops the resolve clock. Paused (snoozed or suppressed) incidents are not counted.'
      : '',
    capped
      ? `I checked up to ${SCAN_PER_URGENCY} of the oldest open incidents per urgency level.`
      : '',
    `As of ${formatWhen(now, timeZone)}. Only data you can read is included.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Integration names people use, mapped to the docs page slug and the name shown. */
const INTEGRATIONS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\bslack\b/, 'slack', 'Slack'],
  [/\b(?:microsoft )?teams\b/, 'microsoft-teams', 'Microsoft Teams'],
  [/\bjira\b/, 'jira', 'Jira'],
  [/\bpagerduty\b|\bpager duty\b/, 'pagerduty', 'PagerDuty'],
  [/\bdatadog\b/, 'datadog', 'Datadog'],
  [/\bgrafana\b/, 'grafana', 'Grafana'],
  [/\bprometheus\b/, 'prometheus', 'Prometheus'],
  [/\bsentry\b/, 'sentry', 'Sentry'],
  [/\bnew ?relic\b/, 'newrelic', 'New Relic'],
  [/\bdynatrace\b/, 'dynatrace', 'Dynatrace'],
  [/\bzabbix\b/, 'zabbix', 'Zabbix'],
  [/\bnagios\b/, 'nagios', 'Nagios'],
  [/\bsplunk\b/, 'splunk-observability', 'Splunk'],
  [/\bcloudwatch\b/, 'cloudwatch', 'CloudWatch'],
  [/\bazure\b/, 'azure', 'Azure'],
  [/\bgithub\b/, 'github', 'GitHub'],
  [/\bgitlab\b/, 'gitlab', 'GitLab'],
  [/\bvercel\b/, 'vercel', 'Vercel'],
  [/\bpingdom\b/, 'pingdom', 'Pingdom'],
  [/\buptime ?robot\b/, 'uptimerobot', 'UptimeRobot'],
  [/\bwebhooks?\b/, 'webhook', 'Webhook'],
];
const CONNECT_VERB = /\b(?:connect|set ?up|integrat\w*|install|configure|hook up|link)\b/;

const CHAT_TOOLS = new Set(['slack', 'microsoft-teams', 'jira']);

export function integrationFor(text: string): { slug: string; name: string } | null {
  if (!CONNECT_VERB.test(text) && !/\b(?:how (?:do|can) i add|add)\b/.test(text)) return null;
  const hit = INTEGRATIONS.find(([pattern]) => pattern.test(text));
  return hit ? { slug: hit[1], name: hit[2] } : null;
}

export async function connectAnswer(slug: string, name: string): Promise<string> {
  // The integration's own page, not whichever guide mentions its name most.
  const hits = await searchProductDocs(`${name} connect configure`, 12).catch(() => []);
  const own = hits.filter(
    hit => hit.url.includes('/integrations/') && hit.url.includes(`/${slug}/`)
  );
  const best =
    own.find(hit => /connect|configure|setup|oauth/i.test(`${hit.url} ${hit.heading}`)) ?? own[0];
  return [
    `## Connect ${name}`,
    `Open **Settings → Integrations → ${name}** and follow the prompts. ${CHAT_TOOLS.has(slug) ? 'Connecting needs an administrator.' : `Alert sources are also added on the service itself (Services → your service → Integrations), which gives you the URL or key to paste into ${name}.`} Never paste keys into chat.`,
    best
      ? `From the OpsKnight docs:\n- **${best.title}**: ${/connect|configure|setup|oauth/i.test(`${best.url} ${best.heading}`) ? `${best.text.length > 240 ? `${best.text.slice(0, 239)}…` : best.text} ` : ''}[Read the guide](${best.url})`
      : 'The integrations guides are at https://opsknight.com/docs/latest/integrations/.',
  ].join('\n\n');
}
