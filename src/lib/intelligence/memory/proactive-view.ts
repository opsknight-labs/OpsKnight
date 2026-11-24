import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, runbookReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { readSourceStates, sourceKey, type SourceIdentity } from '../squire/evidence-access';
import {
  aiInputsVisible,
  briefingContentSchema,
  filterProactiveRefs,
  investigationContentSchema,
  nudgeContentSchema,
  postmortemDraftContentSchema,
  suggestNextSteps,
  type ProactiveRefs,
} from './proactive-content';
import type { InvestigationDigest } from './proactive-digest';
import {
  verificationContentSchema,
  verificationHeadline,
  type VerificationContent,
} from './proactive-verification';

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

export interface InvestigationView {
  createdAt: Date;
  partial: boolean;
  /**
   * The markdown diagnosis, or null when the viewer cannot open one or more of the sources it was built from
   * (the text could quote them, so it is withheld whole).
   */
  answer: string | null;
  citations: Array<{ kind: string; id: string; label: string; href: string }>;
  /** When the latest conclusion was written, and how many runs produced it (1 = the first investigation). */
  updatedAt: Date;
  revision: number;
  /** "What changed" digests, newest first; each only when the viewer can open every source it compares. */
  updates: Array<Omit<InvestigationDigest, 'sources'>>;
}

export interface VerificationView {
  checkedAt: string;
  trigger: VerificationContent['trigger'];
  holding: boolean;
  /** The verdict, built only from facts this viewer may read. */
  headline: string;
  related: VerificationContent['related'];
}

export interface ProactiveNotesView {
  briefing: BriefingView | null;
  nudge: NudgeView | null;
  postmortemDraft: PostmortemDraftView | null;
  /** Absent in views built before automatic investigations existed. */
  investigation?: InvestigationView | null;
  /** Absent in views built before fix checks existed. */
  verification?: VerificationView | null;
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
  actor: AuthorizationActor,
  /** The incident the caller already read through `actor`'s visibility, and only the note kinds it needs. */
  options: { incident?: { id: string; status: string }; kinds?: string[] } = {}
): Promise<ProactiveNotesView | null> {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  let readable;
  try {
    readable = incidentReadWhere(actor);
  } catch {
    return null;
  }
  const incident =
    options.incident?.id === incidentId
      ? options.incident
      : await prisma.incident.findFirst({
          where: { AND: [{ id: incidentId }, readable] },
          select: { id: true, status: true },
        });
  if (!incident) return null;
  const notes = await prisma.squireProactiveNote.findMany({
    where: { incidentId, ...(options.kinds ? { kind: { in: options.kinds } } : {}) },
    select: { kind: true, mode: true, content: true, createdAt: true, updatedAt: true },
  });
  if (notes.length === 0) return null;

  const parsed = {
    briefing: notes.find(note => note.kind === 'BRIEFING'),
    nudge: notes.find(note => note.kind === 'STAKEHOLDER_NUDGE'),
    draft: notes.find(note => note.kind === 'POSTMORTEM_DRAFT'),
    investigation: notes.find(note => note.kind === 'INVESTIGATION'),
    verification: notes.find(note => note.kind === 'VERIFICATION'),
  };
  const briefing = parsed.briefing
    ? briefingContentSchema.safeParse(parsed.briefing.content)
    : null;
  const nudge = parsed.nudge ? nudgeContentSchema.safeParse(parsed.nudge.content) : null;
  const draft = parsed.draft ? postmortemDraftContentSchema.safeParse(parsed.draft.content) : null;
  const verification = parsed.verification
    ? verificationContentSchema.safeParse(parsed.verification.content)
    : null;

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
  if (verification?.success)
    verification.data.related.forEach(item => wanted.incidents.add(item.id));

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
                ? { OR: [{ serviceId: null, unmappedIntegrationId: null }, { service: services! }] }
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

  let investigationView: InvestigationView | null = null;
  const investigation = parsed.investigation
    ? investigationContentSchema.safeParse(parsed.investigation.content)
    : null;
  if (investigation?.success && parsed.investigation) {
    // Every source the investigation (and each digest) read, re-checked under the viewer's own permissions;
    // any miss withholds that text whole.
    const { sources, updates = [] } = investigation.data;
    const all = new Map(
      [...sources, ...updates.flatMap(update => update.sources)].map(source => [
        sourceKey(source as SourceIdentity),
        source as SourceIdentity,
      ])
    );
    const states = await readSourceStates(actor, [...all.values()]);
    const readable = (list: typeof sources) =>
      list.every(source => states.has(sourceKey(source as SourceIdentity)));
    const answerReadable = readable(sources);
    investigationView = {
      createdAt: parsed.investigation.createdAt,
      // When the conclusion was last written; a failed retry also touches the row, so updatedAt would lie.
      updatedAt: Number.isFinite(Date.parse(investigation.data.assessedAt ?? ''))
        ? new Date(investigation.data.assessedAt!)
        : parsed.investigation.updatedAt,
      revision: investigation.data.revision ?? 1,
      partial: investigation.data.partial,
      answer: answerReadable ? investigation.data.answer : null,
      citations: answerReadable ? investigation.data.citations : [],
      updates: updates
        .filter(update => readable(update.sources))
        .map(({ sources: _sources, ...update }) => update),
    };
  }

  let verificationView: VerificationView | null = null;
  if (verification?.success) {
    const related = verification.data.related.filter(item => visible.incidents.has(item.id));
    verificationView = {
      checkedAt: verification.data.checkedAt,
      trigger: verification.data.trigger,
      holding: verification.data.holding,
      headline: verificationHeadline({ ...verification.data, related }),
      related,
    };
  }

  if (!briefingView && !nudgeView && !draftView && !investigationView && !verificationView)
    return null;
  return {
    briefing: briefingView,
    nudge: nudgeView,
    postmortemDraft: draftView,
    investigation: investigationView,
    verification: verificationView,
  };
}
