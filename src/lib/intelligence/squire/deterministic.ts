import 'server-only';
import type { EvidenceSnapshot } from './evidence';
type Collect = (source: EvidenceSnapshot) => void;
import prisma from '@/lib/prisma';
import { readIncidentAnalysisState } from '../analysis/view';
import { redactSecrets } from '../ai/redact';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getRelatedIncidentsForActor } from '../correlation/view';
import { getResponseIntelligenceForActor } from '../response/view';
import { getSimilarIncidentsForActor } from '../similarity/view';
import { routeIntent, incidentIntents, type SquireIntent } from './intents';
import { answerBasicRead } from './basic/reads';
import { productGuidance } from './basic/guidance';
import { mergeBasicQuestion } from './basic/query';

export interface ReadableIncident {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  createdAt: Date;
  updatedAt?: Date;
}

/** The incident, only if the actor may read it. */
export async function readIncidentForActor(
  actor: AuthorizationActor,
  incidentId: string,
  client: typeof prisma = prisma
): Promise<ReadableIncident | null> {
  let readable;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const row = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: {
      id: true,
      title: true,
      status: true,
      urgency: true,
      createdAt: true,
      updatedAt: true,
      service: { select: { name: true } },
    },
  });
  return row
    ? {
        id: row.id,
        title: row.title,
        status: row.status,
        urgency: row.urgency,
        serviceName: row.service.name,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    : null;
}

const minutes = (value: number) =>
  value < 1
    ? 'moments before'
    : value < 90
      ? `${value} min before`
      : `${Math.round(value / 60)} h before`;

async function describeIncident(
  actor: AuthorizationActor,
  incident: ReadableIncident,
  intent: SquireIntent,
  collect?: Collect
): Promise<string> {
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  const head = `${incident.title}\n${incident.serviceName} · ${incident.status.toLowerCase()} · ${incident.urgency.toLowerCase()} urgency`;
  if (intent === 'SIMILAR') {
    const [similar, related] = await Promise.all([
      getSimilarIncidentsForActor(incident.id, actor),
      getRelatedIncidentsForActor(incident.id, actor),
    ]);
    [...(similar ?? []), ...(related ?? [])].forEach(data =>
      collect?.({ kind: 'incident', id: data.incidentId, label: data.title, data })
    );
    const lines = [
      ...(similar ?? []).map(
        item =>
          `• ${item.title} (${item.matchPercent}% match, ${item.status.toLowerCase()}; ${item.serviceName})${item.resolutionSummary ? `\n  Recorded resolution: ${short(item.resolutionSummary)}` : ''}\n  /incidents/${item.incidentId}`
      ),
      ...(related ?? []).map(item => `• Related: ${item.title}\n  /incidents/${item.incidentId}`),
    ];
    return lines.length > 0
      ? [
          'Similar and related incidents (match scores measure similarity, not certainty):',
          ...lines,
        ].join('\n')
      : 'I have no similar or related incidents for this one yet. That does not mean it has never happened: indexing or recommendation analysis may still be catching up.';
  }
  const response = await getResponseIntelligenceForActor(incident.id, actor);
  if (intent === 'CAUSES') {
    response?.changes.forEach(data =>
      collect?.({ kind: 'change', id: data.changeId, label: data.summary, data })
    );
    response?.upstreamIncidents.forEach(data =>
      collect?.({ kind: 'incident', id: data.incidentId, label: data.title, data })
    );
    if (!response || (response.changes.length === 0 && response.upstreamIncidents.length === 0)) {
      return `I have no likely causes recorded for this incident yet.\n\n${suggestedChecks(incident)}\n\nCheck recent deployments and upstream service health; timing alone cannot establish a cause.`;
    }
    const lines = [
      ...response.changes.map(
        c =>
          `• ${c.summary} (${c.kind.replace('_', ' ').toLowerCase()}, ${minutes(c.leadMinutes)} onset)\n  /changes/${c.changeId}`
      ),
      ...response.upstreamIncidents.map(
        u =>
          `• Upstream incident: ${u.title} (${u.serviceName}, ${minutes(u.leadMinutes)} this one)\n  /incidents/${u.incidentId}`
      ),
    ];
    return [
      'Possible causes, based on timing and dependencies. These are leads to verify, not confirmed causes:',
      ...lines,
    ].join('\n');
  }
  if (intent === 'RUNBOOKS') {
    response?.runbooks.forEach(data =>
      collect?.({ kind: 'runbook', id: data.runbookId, label: data.name, data })
    );
    if (!response || response.runbooks.length === 0)
      return `I have no runbook recommendations for this incident.\n\n${suggestedChecks(incident)}\n\nCheck similar resolved incidents for a previously recorded fix, or attach a reviewed runbook to this service.`;
    const lines = response.runbooks.map(
      r =>
        `• ${r.name} — ${r.eligible > 0 ? `succeeded ${r.succeeded} of ${r.eligible} runs here` : 'attached, not run yet'}\n  /runbooks/${r.runbookId}`
    );
    return [
      'Runbooks that fit this service (I can only suggest them; nothing is run for you):',
      ...lines,
      '',
      suggestedChecks(incident),
    ].join('\n');
  }
  if (response?.changes[0]) {
    const data = response.changes[0];
    collect?.({ kind: 'change', id: data.changeId, label: data.summary, data });
  }
  if (response?.runbooks[0]) {
    const data = response.runbooks[0];
    collect?.({ kind: 'runbook', id: data.runbookId, label: data.name, data });
  }
  const similar = await getSimilarIncidentsForActor(incident.id, actor);
  const precedent = similar?.find(row => row.status === 'RESOLVED') ?? similar?.[0];
  if (precedent)
    collect?.({
      kind: 'incident',
      id: precedent.incidentId,
      label: precedent.title,
      data: precedent,
    });
  return [
    head,
    `Opened ${incident.createdAt.toISOString().replace('T', ' ').slice(0, 16)} UTC.`,
    `/incidents/${incident.id}`,
    '',
    response?.changes[0]
      ? `Change to investigate: ${response.changes[0].summary} (a lead to verify).\n/changes/${response.changes[0].changeId}`
      : 'No deployment or change lead is recorded yet.',
    precedent
      ? `Past context: ${precedent.title} (${precedent.matchPercent}% similar).${precedent.resolutionSummary ? ` Recorded resolution: ${short(precedent.resolutionSummary)}` : ''}\n/incidents/${precedent.incidentId}`
      : 'No matching past incident is recorded yet.',
    response?.runbooks[0]
      ? `Suggested runbook: ${response.runbooks[0].name}.\n/runbooks/${response.runbooks[0].runbookId}`
      : 'No reviewed runbook recommendation is recorded yet.',
    '',
    suggestedChecks(incident),
  ].join('\n');
}

/** Who is on call now: the schedules the incident's service escalates to, or every schedule the person can see. */
const short = (text: string) => redactSecrets(text).replace(/\s+/g, ' ').trim().slice(0, 280);

/** Pattern-based investigation prompts, clearly separated from facts and never executed. */
export function suggestedChecks(incident: Pick<ReadableIncident, 'title'>): string {
  const title = incident.title.toLowerCase();
  const checks = /pool|too many connections|connection.*exhaust/.test(title)
    ? [
        'Compare active connections, long-running transactions and pool utilization.',
        'Check pool limits against database capacity and recent configuration changes.',
      ]
    : /disk|no space|storage.*full/.test(title)
      ? [
          'Check filesystem and inode utilization and identify which paths are growing.',
          'Review retention and recent writes before removing data.',
        ]
      : /cert|tls|ssl/.test(title)
        ? [
            'Check certificate expiry, hostname coverage and the served certificate chain.',
            'Compare the failing endpoint with recent certificate or ingress changes.',
          ]
        : /kafka|queue|lag|backlog/.test(title)
          ? [
              'Compare incoming traffic with consumer throughput, lag and error rates.',
              'Check consumer health and downstream dependencies for bottlenecks.',
            ]
          : /5xx|error rate|timeout|latency|slow/.test(title)
            ? [
                'Compare error rate and latency with the last healthy period and recent deployments.',
                'Check upstream dependencies and resource saturation to narrow the affected path.',
              ]
            : [
                'Confirm the affected service, customer impact and whether the alert is still firing.',
                'Compare recent deployments, dependency health and similar resolved incidents.',
              ];
  return [
    'Suggested checks (not a confirmed diagnosis):',
    ...checks.map((check, i) => `${i + 1}. ${check}`),
    'No action has been executed.',
  ].join('\n');
}

const HELP = [
  'I can help with live OpsKnight data, even with AI turned off:',
  '• Your work queue, unassigned incidents, filtered incident search and counts.',
  '• Reports: incident volume, noisy services, period comparisons and bounded mean time to resolution.',
  '• Service health records, ownership, escalation policies and visible dependencies.',
  '• On-call coverage for a named service, now or at a future point in time.',
  '• Runbook catalog, recent changes, postmortems and overdue follow-up tasks.',
  '• Product guidance: schedules, overrides, urgency, integrations, notifications, privacy and permissions.',
  '• Search: "Show checkout incidents from last week" or "Find resolved database incidents".',
  '• On an incident: a briefing, similar incidents and recorded fixes, change leads, runbooks, and a factual timeline.',
  '• Follow-up questions in the same chat, with fresh permission-checked data.',
  'I never change anything on my own. AI adds free-form reasoning and action proposals; proposed actions still need your confirmation.',
].join('\n');

async function timeline(incident: ReadableIncident, collect?: Collect): Promise<string> {
  const events = await prisma.incidentEvent.findMany({
    where: { incidentId: incident.id },
    take: 8,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { type: true, createdAt: true },
  });
  collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  return [
    `Recorded timeline for ${short(incident.title)}:`,
    `• ${incident.createdAt.toISOString()} — Incident opened.`,
    ...events
      .reverse()
      .map(
        event =>
          `• ${event.createdAt.toISOString()} — ${(event.type ?? 'EVENT').replace(/_/g, ' ').toLowerCase()}.`
      ),
    `/incidents/${incident.id}`,
    'This is the recorded event sequence, not an explanation of causality.',
  ].join('\n');
}

/** Deterministic answers use source facts and fixed investigation templates, never a model. */
export async function answerDeterministically(
  actor: AuthorizationActor,
  message: string,
  incident: ReadableIncident | null,
  collect?: Collect,
  options: { name?: string; previousQuestions?: readonly string[] } = {}
): Promise<string> {
  let intent = routeIntent(message, incident !== null);
  const previous = options.previousQuestions?.at(-1);
  const followup = /^(and|also|more|tell me more|what else|continue|explain|what about)\b/i.test(
    message.trim()
  );
  if (previous && followup && intent === 'UNKNOWN')
    intent = routeIntent(previous, incident !== null);
  if (incident && (intent === 'GREETING' || intent === 'UNKNOWN'))
    collect?.({ kind: 'incident', id: incident.id, label: incident.title, data: incident });
  if (intent === 'GREETING')
    return `Hi, I'm ${options.name ?? 'Squire'}. ${incident ? `I'm looking at ${short(incident.title)}. Ask for a briefing, past fixes or next steps.` : 'I can check incidents, your work queue, service ownership, on-call coverage, runbooks and follow-up tasks. What would you like to check?'}`;
  if (intent === 'THANKS')
    return incident
      ? 'You’re welcome. I can also check the incident timeline, similar past fixes, or who is on call.'
      : 'You’re welcome. I’m here when you need an incident lookup or an on-call check.';
  if (intent === 'HELP') return HELP;
  if (intent === 'GUIDANCE') return productGuidance(message);
  const readAnswer = await answerBasicRead(
    intent,
    actor,
    previous && followup ? mergeBasicQuestion(previous, message) : message,
    incident,
    collect
  );
  if (readAnswer !== null) return readAnswer;
  if (!incident)
    return 'I can look up OpsKnight data without an AI provider. Try “My open incidents”, “How many incidents this week?”, “Who owns Checkout?”, “Who is on call?”, or “Find checkout incidents from last week”. Open an incident for a briefing, likely change leads, recorded fixes and runbooks.';
  if (intent === 'TIMELINE') return timeline(incident, collect);
  if (intent === 'UNKNOWN')
    return `I haven't matched that to a supported lookup yet. For ${short(incident.title)}, try a briefing, similar incidents, causes, runbooks, responders, postmortems, follow-up work or the timeline. You can also ask about service ownership, incident counts or how OpsKnight works.`;
  const requested = incidentIntents(message);
  const sections =
    requested.length > 1
      ? requested.filter(
          section => section !== 'RUNBOOKS' || !requested.includes('INCIDENT_SUMMARY')
        )
      : [intent];
  const answers = await Promise.all(
    sections.map(section => describeIncident(actor, incident, section, collect))
  );
  const freshness = await readIncidentAnalysisState(actor, incident.id).catch(() => null);
  const note =
    freshness?.status === 'CURRENT'
      ? 'Analysis is current.'
      : freshness
        ? `${freshness.message} Suggestions below may be incomplete or out of date.`
        : 'Recommendation freshness could not be verified; check the incident before acting.';
  return [note, ...answers].join('\n\n');
}
