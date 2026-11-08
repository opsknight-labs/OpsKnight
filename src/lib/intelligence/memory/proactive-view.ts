import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  aiInputsVisible,
  briefingContentSchema,
  filterProactiveRefs,
  nudgeContentSchema,
  postmortemDraftContentSchema,
  suggestNextSteps,
  type ProactiveRefs,
} from './proactive-content';

export interface BriefingView {
  createdAt: Date;
  mode: 'BASIC' | 'AI';
  headline: string;
  facts: string[];
  analysisPending: boolean;
  refs: ProactiveRefs;
  /** AI text, present only when the viewer may read every record the model saw. */
  ai: {
    headline: string;
    currentState: string;
    possibleCauses: string[];
    nextSteps: string[];
  } | null;
  nextSteps: string[];
}

export interface NudgeView {
  updatedAt: Date;
  minutesSinceUpdate: number;
  thresholdMinutes: number;
  draft: string;
  aiDraft: string | null;
}

export interface PostmortemDraftView {
  createdAt: Date;
  mode: 'BASIC' | 'AI';
  summary: string;
  impact: string;
  rootCause: string;
  resolution: string;
  lessons: string;
  timeline: Array<{ at: string; text: string }>;
  actionItems: Array<{ title: string; priority: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  refs: ProactiveRefs;
}

export interface ProactiveNotesView {
  briefing: BriefingView | null;
  nudge: NudgeView | null;
  postmortemDraft: PostmortemDraftView | null;
}

async function ids<T extends { id: string }>(load: () => Promise<T[]>): Promise<Set<string>> {
  try {
    return new Set((await load()).map(row => row.id));
  } catch {
    return new Set();
  }
}

/**
 * Proactive notes for one incident as `actor` may see them. Null when the viewer cannot read the incident or
 * intelligence suggestions, or there is nothing to show. References are filtered through the viewer's read rules,
 * and AI-written text is shown only when every record the model saw is readable to the viewer; otherwise the
 * deterministic version is shown. A nudge disappears once anyone posts an update.
 */
export async function getProactiveNotesForActor(
  incidentId: string,
  actor: AuthorizationActor
): Promise<ProactiveNotesView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const incident = await prisma.incident.findFirst({
    where: { AND: [{ id: incidentId }, readable] },
    select: { id: true, status: true },
  });
  if (!incident) return null;
  const notes = await prisma.squireProactiveNote.findMany({
    where: { incidentId },
    select: { kind: true, mode: true, content: true, createdAt: true, updatedAt: true },
  });
  if (notes.length === 0) return null;

  const parsed = {
    briefing: notes.find(note => note.kind === 'BRIEFING'),
    nudge: notes.find(note => note.kind === 'STAKEHOLDER_NUDGE'),
    draft: notes.find(note => note.kind === 'POSTMORTEM_DRAFT'),
  };
  const briefing = parsed.briefing
    ? briefingContentSchema.safeParse(parsed.briefing.content)
    : null;
  const nudge = parsed.nudge ? nudgeContentSchema.safeParse(parsed.nudge.content) : null;
  const draft = parsed.draft ? postmortemDraftContentSchema.safeParse(parsed.draft.content) : null;

  const wanted = {
    incidents: new Set<string>(),
    changes: new Set<string>(),
    runbooks: new Set<string>(),
  };
  const collect = (
    refs: ProactiveRefs,
    inputs?: { incidents: string[]; changes: string[]; runbooks: string[] }
  ) => {
    refs.similar.forEach(item => wanted.incidents.add(item.id));
    refs.changes.forEach(item => wanted.changes.add(item.id));
    refs.runbooks.forEach(item => wanted.runbooks.add(item.id));
    inputs?.incidents.forEach(id => wanted.incidents.add(id));
    inputs?.changes.forEach(id => wanted.changes.add(id));
    inputs?.runbooks.forEach(id => wanted.runbooks.add(id));
  };
  if (briefing?.success) collect(briefing.data.refs, briefing.data.ai?.inputRefs);
  if (draft?.success) collect(draft.data.refs, draft.data.ai?.inputRefs);

  let services: ReturnType<typeof serviceReadWhere> | null = null;
  try {
    services = serviceReadWhere(actor);
  } catch {
    services = null;
  }
  const [incidents, changes, runbooks] = await Promise.all([
    wanted.incidents.size
      ? ids(() =>
          prisma.incident.findMany({
            where: { AND: [{ id: { in: [...wanted.incidents] } }, readable] },
            select: { id: true },
          })
        )
      : new Set<string>(),
    wanted.changes.size && services
      ? ids(() =>
          prisma.changeEvent.findMany({
            where: {
              id: { in: [...wanted.changes] },
              ...(Object.keys(services!).length
                ? { OR: [{ serviceId: null }, { service: services! }] }
                : {}),
            },
            select: { id: true },
          })
        )
      : new Set<string>(),
    wanted.runbooks.size
      ? ids(() =>
          prisma.runbook.findMany({
            where: {
              AND: [
                { id: { in: [...wanted.runbooks] }, archivedAt: null },
                runbookReadWhere(actor),
              ],
            },
            select: { id: true },
          })
        )
      : new Set<string>(),
  ]);
  const visible = { incidents, changes, runbooks };
  const open = incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED';

  let briefingView: BriefingView | null = null;
  if (briefing?.success && parsed.briefing) {
    const refs = filterProactiveRefs(briefing.data.refs, visible);
    const ai =
      briefing.data.ai && aiInputsVisible(briefing.data.ai.inputRefs, visible)
        ? briefing.data.ai
        : null;
    briefingView = {
      createdAt: parsed.briefing.createdAt,
      mode: ai ? 'AI' : 'BASIC',
      headline: briefing.data.headline,
      facts: briefing.data.facts,
      analysisPending: briefing.data.analysisPending,
      refs,
      ai: ai
        ? {
            headline: ai.headline,
            currentState: ai.currentState,
            possibleCauses: ai.possibleCauses,
            nextSteps: ai.nextSteps,
          }
        : null,
      nextSteps: suggestNextSteps(refs),
    };
  }

  let nudgeView: NudgeView | null = null;
  if (open && nudge?.success && parsed.nudge) {
    const since = new Date(nudge.data.lastUpdateAt);
    const [note, announcement] = await Promise.all([
      prisma.incidentNote.findFirst({
        where: { incidentId, createdAt: { gt: since } },
        select: { id: true },
      }),
      prisma.statusPageAnnouncement.findFirst({
        where: { incidentId, updatedAt: { gt: since } },
        select: { id: true },
      }),
    ]);
    if (!note && !announcement)
      nudgeView = {
        updatedAt: parsed.nudge.updatedAt,
        minutesSinceUpdate: nudge.data.minutesSinceUpdate,
        thresholdMinutes: nudge.data.thresholdMinutes,
        draft: nudge.data.draft,
        aiDraft: nudge.data.ai?.draft ?? null,
      };
  }

  let draftView: PostmortemDraftView | null = null;
  if (draft?.success && parsed.draft) {
    const ai =
      draft.data.ai && aiInputsVisible(draft.data.ai.inputRefs, visible) ? draft.data.ai : null;
    const base = ai ?? draft.data;
    draftView = {
      createdAt: parsed.draft.createdAt,
      mode: ai ? 'AI' : 'BASIC',
      summary: base.summary,
      impact: base.impact,
      rootCause: base.rootCause,
      resolution: base.resolution,
      lessons: base.lessons,
      actionItems: base.actionItems,
      timeline: draft.data.timeline,
      refs: filterProactiveRefs(draft.data.refs, visible),
    };
  }

  if (!briefingView && !nudgeView && !draftView) return null;
  return { briefing: briefingView, nudge: nudgeView, postmortemDraft: draftView };
}
