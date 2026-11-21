import 'server-only';
import { cache } from 'react';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import type { IntelligenceModeValue } from '../contract';
import { resolveEffectivePolicy, resolveEffectivePolicyForRequest } from '../settings/service';
import { getAiPublicStatus } from '../ai/settings';
import { readIncidentAnalysisState } from '../analysis/view';
import type { IncidentAnalysisState } from '../analysis/contract';
import { getSimilarIncidentsForActor, type SimilarIncidentView } from '../similarity/view';
import { getRelatedIncidentsForActor, type RelatedIncidentView } from '../correlation/view';
import { getResponseIntelligenceForActor, type ResponseIntelligenceView } from '../response/view';
import { getTriageForActor, type TriageView } from '../triage/view';
import { getIncidentImpactForActor, isImpactEmpty, type IncidentImpactView } from '../impact/view';
import { getProactiveNotesForActor, type ProactiveNotesView } from '../memory/proactive-view';
import { getIncidentTimeAxisForActor, type IncidentTimeAxis } from '../timeline/service';
import { getIncidentGroupForActor, type IncidentGroupView } from './group-view';
import { getIncidentListBadges } from './list-badges';
import { NOISE_DECISION_TONE } from './explain';
import {
  FRESHNESS_DOT_STATUSES,
  INSIGHTS_SECTIONS,
  type InsightsSectionId,
  type StripChip,
} from './strip-contract';

export {
  FRESHNESS_DOT_STATUSES,
  INSIGHTS_SECTIONS,
  INSIGHTS_SECTION_LABEL,
  isInsightsSection,
  type InsightsSectionId,
  type StripChip,
} from './strip-contract';

/**
 * Everything the incident page shows about intelligence, read ONCE per request: the strip under the command
 * bar, the hero's group line, the suggested-runbooks group and every section of the insights inspector all
 * render from this one result, so a fact is fetched once and shown in one canonical place.
 *
 * Composed from the existing view functions. Each of them already applies the viewer's read scope
 * (`incidentReadWhere`, `serviceReadWhere`, `runbookReadWhere`) and caps its own queries with `take`; this
 * loader adds no query of its own beyond one incident lookup. Every part is fail-soft: a failing view is logged
 * and treated as "nothing to show", never as a page error.
 *
 * Service mode: OFF yields `null` for responders (nothing renders anywhere). Intelligence managers get a
 * result with `mode: 'OFF'` carrying only links a person or the engine already accepted and the storm group,
 * so a grouping made before the switch-off can still be undone from the inspector.
 */

export interface NoiseState {
  kind: 'suppressed' | 'maintenance';
  label: string;
}

export interface IncidentInsights {
  incidentId: string;
  mode: IntelligenceModeValue;
  /** INTELLIGENCE_MANAGE: sees the "off" hint and the refresh action. */
  canManage: boolean;
  /** INTELLIGENCE_FEEDBACK: may rate, accept, reject and link. */
  canGiveFeedback: boolean;
  canExecuteRunbooks: boolean;
  /** The note composer's permission; server actions re-check it. */
  canPostNote: boolean;
  analysis: IncidentAnalysisState | null;
  proactive: ProactiveNotesView | null;
  triage: TriageView | null;
  similar: SimilarIncidentView[] | null;
  related: RelatedIncidentView[] | null;
  group: IncidentGroupView | null;
  response: ResponseIntelligenceView | null;
  impact: IncidentImpactView | null;
  noise: NoiseState[];
  ai: { summaryEnabled: boolean };
  squire: { enabled: boolean; mobileEnabled: boolean; name: string };
}

export interface IncidentInsightsDeps {
  client?: typeof prisma;
  now?: Date;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function soft<T>(incidentId: string, part: string, read: () => Promise<T>, empty: T) {
  try {
    return await read();
  } catch (error) {
    logger.warn(`[Intelligence] Incident insights: ${part} unavailable`, {
      incidentId,
      error: errorText(error),
    });
    return empty;
  }
}

export async function loadIncidentInsights(
  incidentId: string,
  actor: AuthorizationActor,
  deps: IncidentInsightsDeps = {}
): Promise<IncidentInsights | null> {
  const client = deps.client ?? prisma;
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable: ReturnType<typeof incidentReadWhere>;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const incident = await client.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { serviceId: true },
  });
  if (!incident) return null;

  const policy =
    client === prisma
      ? await resolveEffectivePolicyForRequest(incident.serviceId)
      : await resolveEffectivePolicy(incident.serviceId, client);
  const mode = policy.effectiveMode;
  const active = actor.status === 'ACTIVE';
  const canManage = active && hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  if (mode === 'OFF' && !canManage) return null;

  const base = {
    incidentId,
    mode,
    canManage,
    canGiveFeedback: active && hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK),
    canExecuteRunbooks: active && hasCapability(actor.role, CAPABILITIES.RUNBOOK_EXECUTE),
    canPostNote: active && hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE),
  };
  const related = soft(
    incidentId,
    'related incidents',
    () => getRelatedIncidentsForActor(incidentId, actor, client),
    null
  );
  const group = soft(
    incidentId,
    'group',
    () => getIncidentGroupForActor(incidentId, actor, client),
    null
  );

  if (mode === 'OFF') {
    return {
      ...base,
      analysis: null,
      proactive: null,
      triage: null,
      similar: null,
      related: await related,
      group: await group,
      response: null,
      impact: null,
      noise: [],
      ai: { summaryEnabled: false },
      squire: { enabled: false, mobileEnabled: false, name: 'Squire' },
    };
  }

  const [analysis, proactive, triage, similar, response, impact, badges, ai] = await Promise.all([
    soft<IncidentAnalysisState | null>(
      incidentId,
      'analysis state',
      // The analysis reader has no client parameter; it reads through the shared client.
      () => readIncidentAnalysisState(actor, incidentId),
      {
        status: 'UNAVAILABLE',
        message: 'Analysis is temporarily unavailable. Earlier suggestions have not been verified.',
        canRefresh: false,
      }
    ),
    soft(incidentId, 'briefing', () => getProactiveNotesForActor(incidentId, actor), null),
    soft(incidentId, 'triage', () => getTriageForActor(incidentId, actor, client), null),
    soft(
      incidentId,
      'similar incidents',
      () => getSimilarIncidentsForActor(incidentId, actor, client),
      null
    ),
    soft(
      incidentId,
      'causes and runbooks',
      () => getResponseIntelligenceForActor(incidentId, actor, client),
      null
    ),
    soft(
      incidentId,
      'impact',
      () => getIncidentImpactForActor(incidentId, actor, client, deps.now),
      null
    ),
    soft(
      incidentId,
      'noise decisions',
      () => getIncidentListBadges([incidentId], actor, { now: deps.now }, client),
      {}
    ),
    soft(incidentId, 'assistant status', () => getAiPublicStatus(client), null),
  ]);

  const noise: NoiseState[] = [];
  for (const badge of new Map(Object.entries(badges)).get(incidentId) ?? []) {
    if (badge.kind === 'suppressed' || badge.kind === 'maintenance')
      noise.push({ kind: badge.kind, label: badge.label });
  }

  return {
    ...base,
    analysis,
    proactive,
    triage,
    similar,
    related: await related,
    group: await group,
    response,
    impact,
    noise,
    ai: { summaryEnabled: Boolean(ai?.aiEnabled) },
    squire: {
      enabled: Boolean(ai?.squireEnabled),
      mobileEnabled: Boolean(ai?.squireEnabled && ai?.mobileEnabled),
      name: ai?.squireName ?? 'Squire',
    },
  };
}

/** One read per server-rendered incident page, shared by the strip, hero line, runbooks group and inspector. */
export const incidentInsightsForRequest = cache(
  async (incidentId: string): Promise<IncidentInsights | null> => {
    try {
      return await loadIncidentInsights(incidentId, await getCurrentAuthorizationActor());
    } catch (error) {
      logger.warn('[Intelligence] Incident insights unavailable', {
        incidentId,
        error: errorText(error),
      });
      return null;
    }
  }
);

/** The intelligence time axis for the core Timeline tab's overlay; null when off, unreadable or failing. */
export const incidentTimeAxisForRequest = cache(
  async (incidentId: string): Promise<IncidentTimeAxis | null> => {
    try {
      const insights = await incidentInsightsForRequest(incidentId);
      if (!insights || insights.mode === 'OFF') return null;
      return await getIncidentTimeAxisForActor(incidentId, await getCurrentAuthorizationActor());
    } catch (error) {
      logger.warn('[Intelligence] Incident time axis unavailable', {
        incidentId,
        error: errorText(error),
      });
      return null;
    }
  }
);

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Sections of the inspector that have something to show, in their fixed order. */
export function insightsSections(insights: IncidentInsights): InsightsSectionId[] {
  const { proactive, response } = insights;
  const has = new Map<InsightsSectionId, boolean>([
    [
      'briefing',
      Boolean(proactive && (proactive.briefing || proactive.nudge || proactive.postmortemDraft)),
    ],
    ['triage', Boolean(insights.triage?.suggestions.length)],
    ['similar', Boolean(insights.similar?.length)],
    ['related', Boolean(insights.related?.length || insights.group)],
    [
      'why',
      Boolean(
        response?.changes.length ||
        response?.upstreamIncidents.length ||
        response?.metricAnomalies?.length
      ),
    ],
    ['runbooks', Boolean(response?.runbooks.length)],
    ['impact', Boolean(insights.impact && !isImpactEmpty(insights.impact))],
    // One summary per incident: when the briefing already carries an AI summary, it is the summary.
    ['summary', insights.mode !== 'OFF' && insights.ai.summaryEnabled && !proactive?.briefing?.ai],
  ]);
  return INSIGHTS_SECTIONS.filter(section => has.get(section));
}

/**
 * The strip's chips: only those with content, in a fixed order. The storm group is stated once, in the hero's
 * group line, so it has no chip here; noise decisions live on the core Timeline, so their chip links there.
 */
export function buildStripChips(insights: IncidentInsights): StripChip[] {
  if (insights.mode === 'OFF') return [];
  const chips: StripChip[] = [];

  const pending = (insights.triage?.suggestions ?? []).filter(s => s.myVerdict === null);
  if (pending.length) {
    const parts = [
      ...pending.flatMap(s => (s.urgency ? [`urgency ${s.urgency}`] : [])),
      ...pending.flatMap(s => (s.owner ? [clip(s.owner.name, 28)] : [])),
      ...(pending.some(s => s.duplicate) ? ['possible duplicate'] : []),
    ];
    chips.push({
      id: 'triage',
      target: { section: 'triage' },
      tone: 'info',
      label: parts.length
        ? `Triage: ${parts.slice(0, 2).join(' · ')}`
        : `${pending.length} triage ${pending.length === 1 ? 'hint' : 'hints'}`,
    });
  }

  if (insights.similar?.length)
    chips.push({
      id: 'similar',
      target: { section: 'similar' },
      tone: 'neutral',
      label: `${insights.similar.length} similar`,
    });

  const change = insights.response?.changes[0];
  const upstream = insights.response?.upstreamIncidents[0];
  if (change || upstream)
    chips.push({
      id: 'why',
      target: { section: 'why' },
      tone: 'elevated',
      label: `Likely cause: ${clip(change ? change.summary : `upstream ${upstream!.serviceName}`, 40)}`,
    });

  for (const state of insights.noise)
    chips.push({
      id: `noise-${state.kind}`,
      target: { anchor: 'timeline-intelligence' },
      tone: NOISE_DECISION_TONE[state.kind],
      label: clip(state.label, 44),
    });

  if (insights.impact && !isImpactEmpty(insights.impact)) {
    const services = insights.impact.downstream.length;
    const slo = insights.impact.slo;
    const burning = slo.state === 'AVAILABLE' && slo.severity !== 'none';
    const parts = [
      ...(services
        ? [
            `${services}${insights.impact.downstreamTruncated ? '+' : ''} ${services === 1 ? 'service' : 'services'}`,
          ]
        : []),
      ...(burning ? ['SLO burning'] : []),
    ];
    // Status-page components or a healthy objective alone are context, not a headline: no chip.
    if (parts.length)
      chips.push({
        id: 'impact',
        target: { section: 'impact' },
        tone: slo.state === 'AVAILABLE' && slo.severity === 'critical' ? 'critical' : 'elevated',
        label: `Impact: ${parts.join(', ')}`,
      });
  }

  if (insights.proactive?.briefing)
    chips.push({
      id: 'briefing',
      target: { section: 'briefing' },
      tone: 'ok',
      label: 'Briefing ready',
    });
  else if (insights.proactive?.nudge)
    chips.push({
      id: 'briefing',
      target: { section: 'briefing' },
      tone: 'elevated',
      label: 'Stakeholder update due',
    });

  return chips;
}

/** Whether the strip shows the freshness dot: only while analysis is unfinished, failed or unverifiable. */
export function showsFreshnessDot(analysis: IncidentAnalysisState | null): boolean {
  return Boolean(analysis && FRESHNESS_DOT_STATUSES.includes(analysis.status));
}
