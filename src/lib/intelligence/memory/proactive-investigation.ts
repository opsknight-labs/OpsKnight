import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, type Capability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { checkRateLimit } from '@/lib/rate-limit';
import { registerAiGateway } from '../ai/gateway';
import { resolveLanguageModel, type AiDataClass } from '../ai/port';
import { getGuidance } from '../ai/prompts';
import { getAiSettings } from '../ai/settings';
import { AI_SETTINGS_DEFAULTS } from '../ai/contract';
import { listEligibleConnections } from '../connectors/service';
import { SquireEvidenceRegistry } from '../squire/evidence';
import { readSourceStates, sourceKey } from '../squire/evidence-access';
import { buildSystemPrompt } from '../squire/prompt';
import { streamInvestigation } from '../squire/investigation/turn';
import { PROACTIVE_AI_ACTOR } from './contract';
import type { InvestigationContent } from './proactive-content';
import { squireKnowledgeEnabled } from './settings';

/** Read-only capabilities of a scoped team member: no "read all", no write capability at all. */
const TEAM_READ_CAPABILITIES: ReadonlySet<Capability> = new Set([
  CAPABILITIES.INCIDENT_READ_SCOPED,
  CAPABILITIES.SERVICE_READ_SCOPED,
  CAPABILITIES.METRICS_READ_SCOPED,
  CAPABILITIES.SCHEDULE_READ_SCOPED,
  CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ,
]);

/**
 * The identity an automatic investigation reads as: never a system actor with global reads, but a read-only
 * member of the incident's owning team. Its reads see public incidents, services, metrics and schedules of that
 * team and nothing else (no private incidents, no runbooks, no other teams), and it can never write: the
 * investigation only offers READ tools, and its capabilities hold no write permission either. Its id is the
 * background AI identity, so it matches no assignee or watcher and spends no person's AI share.
 */
export function teamReadActor(teamId: string): AuthorizationActor {
  return {
    id: PROACTIVE_AI_ACTOR,
    role: 'USER',
    status: 'ACTIVE',
    teamIds: [teamId],
    capabilities: TEAM_READ_CAPABILITIES,
  };
}

const QUESTION = (incidentId: string) =>
  `Investigate incident ${incidentId}: what is the most likely cause, and what should the responders check next? Say "inconclusive" when the evidence does not establish a cause.`;

/**
 * Runs one investigation for one incident as its owning team, through the same engine, gateway admission, token
 * ceiling and data-class rules as an investigation turn in chat. Null means "write nothing": AI or investigation
 * mode off, the per-service spend limit reached, no provider for Personal data, no owning team, the incident not
 * readable by that team, or nothing concluded.
 */
export async function investigateIncident(
  incidentId: string,
  serviceId: string,
  signal?: AbortSignal
): Promise<InvestigationContent | null> {
  const settings = await getAiSettings();
  if (!settings.enabled || !settings.squireEnabled || !settings.squireInvestigationEnabled)
    return null;
  if (signal?.aborted) return null;
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: { teamId: true, service: { select: { teamId: true } } },
  });
  const teamId = incident?.teamId ?? incident?.service.teamId;
  if (!teamId) return null;
  const actor = teamReadActor(teamId);
  // The owning team must be able to open the incident itself (a private incident is never investigated).
  const scope = await readSourceStates(actor, [{ kind: 'incident', id: incidentId }]);
  if (!scope.has(sourceKey({ kind: 'incident', id: incidentId }))) return null;
  // Shares the proactive notes' daily cap per service (one atomic counter).
  if (
    settings.spendControlsEnabled &&
    !(
      await checkRateLimit(
        `ai:proactive-notes:${serviceId}`,
        settings.proactiveNotesPerServiceDaily ??
          AI_SETTINGS_DEFAULTS.proactiveNotesPerServiceDaily,
        86_400_000
      )
    ).allowed
  )
    return null;

  registerAiGateway();
  // Like a chat turn: incident text can name people, so only a provider cleared for Personal data may run it.
  const dataClass: AiDataClass = 'PERSONAL';
  const port = await resolveLanguageModel('SQUIRE_CHAT', dataClass);
  if (!port) return null;
  const [guidance, observability, knowledge] = await Promise.all([
    getGuidance('squire.system').catch(() => null),
    listEligibleConnections(actor).catch(() => []),
    squireKnowledgeEnabled().catch(() => false),
  ]);
  const prompt = buildSystemPrompt(settings.squireName, null, guidance);
  const evidence = new SquireEvidenceRegistry(actor, dataClass);

  let answer = '';
  let partial = false;
  let citations: InvestigationContent['citations'] = [];
  for await (const event of streamInvestigation({
    actor,
    question: QUESTION(incidentId),
    preamble: [{ role: 'system', content: prompt.system, dataClass }],
    context: {
      actorId: PROACTIVE_AI_ACTOR,
      callSite: 'proactive',
      dataClass,
      incidentId,
      signal,
      prompt: prompt.meta,
    },
    dataClass,
    chatPort: port,
    settings,
    evidence,
    labels: {},
    suggestions: [],
    verifiedHash: '',
    observability,
    knowledge,
    finish: async () => ({ type: 'done' }),
    // The planner could not start: no ordinary chat answer here, the next scan may try again.
    fallback: async function* () {},
  })) {
    if (event.type === 'delta') answer += event.text;
    else if (event.type === 'citations')
      citations = event.items.map(item => ({
        kind: item.kind,
        id: item.id,
        label: item.label.slice(0, 300),
        href: item.href,
      }));
    else if (event.type === 'memory') partial = Boolean(event.turn.notices?.length);
  }
  answer = answer.trim();
  if (!answer) return null;
  return {
    v: 1,
    answer: answer.slice(0, 20_000),
    partial,
    teamId,
    sources: evidence
      .sources()
      .slice(0, 64)
      .map(source => ({ kind: source.kind, id: source.id })),
    citations: citations.slice(0, 32),
  };
}
