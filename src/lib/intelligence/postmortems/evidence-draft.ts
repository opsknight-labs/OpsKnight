import type { PostmortemRecurrence } from './recurrence';

/**
 * Turns what the intelligence engine already knows about an incident into postmortem text and action-item
 * suggestions. Pure and deterministic (no model, no database): the loader in `./loaders` gathers the
 * evidence under the viewer's read rules, and the person reviews everything before saving.
 */

export interface DraftTimelineEvent {
  id: string;
  timestamp: string;
  type: 'DETECTION' | 'ESCALATION' | 'MITIGATION' | 'RESOLUTION';
  title: string;
  description: string;
  actor?: string;
}

export interface DraftFields {
  timeline: DraftTimelineEvent[];
  rootCause: string;
  resolution: string;
  lessons: string;
}

export interface EvidenceChange {
  id: string;
  kind: string;
  summary: string;
  serviceName: string | null;
  leadMinutes: number;
  /** A responder marked this cause suggestion helpful. */
  accepted: boolean;
}

export interface EvidenceUpstreamIncident {
  incidentId: string;
  title: string;
  serviceName: string;
  leadMinutes: number;
  accepted: boolean;
}

export interface EvidenceRunbookRun {
  id: string;
  name: string;
  status: string;
  at: Date | null;
  recoveryOutcome: string | null;
}

export interface PostmortemEvidence {
  /** Entries of the intelligence time axis worth a line in the postmortem timeline. */
  axis: Array<{
    kind: string;
    at: Date;
    title: string;
    detail: string | null;
    /** The other incident an entry names (upstream, grouping), so a stored draft can leave it out. */
    incidentId?: string | null;
  }>;
  changes: EvidenceChange[];
  upstreamIncidents: EvidenceUpstreamIncident[];
  runbookRuns: EvidenceRunbookRun[];
  /** Similar past incidents whose fix is known (postmortem resolution or resolution note). */
  similarFixes: Array<{ incidentId: string; title: string; fix: string }>;
  recurrence: PostmortemRecurrence | null;
}

export const EVIDENCE_LIMITS = { timelineEntries: 30, causes: 3, suggestions: 5 } as const;

const clip = (text: string, max: number) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const CHANGE_NOUN = new Map([
  ['DEPLOY', 'Deploy'],
  ['CONFIG', 'Configuration change'],
  ['FEATURE_FLAG', 'Feature flag change'],
  ['INFRA', 'Infrastructure change'],
]);
const changeNoun = (kind: string) => CHANGE_NOUN.get(kind) ?? 'Change';
const lead = (minutes: number) => (minutes <= 0 ? 'at onset' : `${minutes} min before onset`);
const changeLine = (change: EvidenceChange) =>
  `${changeNoun(change.kind)} "${clip(change.summary, 160)}"${change.serviceName ? ` on ${change.serviceName}` : ''}, ${lead(change.leadMinutes)}`;
const upstreamLine = (incident: EvidenceUpstreamIncident) =>
  `Upstream incident "${clip(incident.title, 160)}" on ${incident.serviceName}, ${lead(incident.leadMinutes)}`;

const AXIS_TYPE: Record<string, { type: DraftTimelineEvent['type']; label: string }> = {
  ALERT: { type: 'DETECTION', label: 'Alert' },
  CHANGE: { type: 'DETECTION', label: 'Change' },
  UPSTREAM_INCIDENT: { type: 'ESCALATION', label: 'Upstream incident' },
  GROUPING: { type: 'ESCALATION', label: 'Grouping' },
  CHAT: { type: 'MITIGATION', label: 'War room' },
};
/** War-room messages in a draft timeline; the rest stay on the incident timeline. */
const DRAFT_CHAT_MAX = 10;

const RUN_SUCCEEDED = new Set(['SUCCEEDED']);
const RUN_FAILED = new Set(['FAILED', 'TIMED_OUT']);

function evidenceTimeline(evidence: PostmortemEvidence): DraftTimelineEvent[] {
  const entries: DraftTimelineEvent[] = [];
  let firstAlertSeen = false;
  let chat = 0;
  evidence.axis.forEach((entry, index) => {
    const mapped = AXIS_TYPE[entry.kind];
    if (!mapped) return;
    if (entry.kind === 'CHAT' && ++chat > DRAFT_CHAT_MAX) return;
    // One alert marks detection; an alert storm would bury the rest of the timeline.
    if (entry.kind === 'ALERT') {
      if (firstAlertSeen) return;
      firstAlertSeen = true;
    }
    entries.push({
      id: `draft-axis-${index}`,
      timestamp: entry.at.toISOString(),
      type: mapped.type,
      title: clip(`${mapped.label}: ${entry.title}`, 80),
      description: [entry.title, entry.detail].filter(Boolean).join(' · '),
      actor: 'System',
    });
  });
  for (const run of evidence.runbookRuns) {
    if (!run.at) continue;
    entries.push({
      id: `draft-run-${run.id}`,
      timestamp: run.at.toISOString(),
      type: 'MITIGATION',
      title: clip(`Runbook: ${run.name}`, 80),
      description: `Runbook "${run.name}" ${run.status.toLowerCase().replace(/_/g, ' ')}${run.recoveryOutcome === 'RESOLVED' ? ' (recovery verified)' : ''}.`,
      actor: 'System',
    });
  }
  return entries.slice(0, EVIDENCE_LIMITS.timelineEntries);
}

/**
 * Fills the template draft with evidence. A section with no evidence keeps the template text, so with
 * nothing known the draft is exactly the template draft.
 */
export function applyEvidenceToDraft<T extends DraftFields>(
  base: T,
  evidence: PostmortemEvidence,
  formatTime: (at: Date) => string = at => at.toISOString()
): T {
  const timeline = [...base.timeline, ...evidenceTimeline(evidence)].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const confirmed = [
    ...evidence.changes.filter(change => change.accepted).map(changeLine),
    ...evidence.upstreamIncidents.filter(incident => incident.accepted).map(upstreamLine),
  ];
  const correlated = [
    ...evidence.changes.filter(change => !change.accepted).map(changeLine),
    ...evidence.upstreamIncidents.filter(incident => !incident.accepted).map(upstreamLine),
  ].slice(0, EVIDENCE_LIMITS.causes);
  const bullets = (lines: string[]) => lines.map(line => `- ${line}`).join('\n');
  const rootCause = confirmed.length
    ? `Confirmed by responders during the incident:\n${bullets(confirmed.slice(0, EVIDENCE_LIMITS.causes))}`
    : correlated.length
      ? `To be determined. Seen shortly before onset (correlation only, not a confirmed cause):\n${bullets(correlated)}`
      : base.rootCause;

  const runLines = evidence.runbookRuns
    .filter(run => RUN_SUCCEEDED.has(run.status) || RUN_FAILED.has(run.status))
    .map(run => {
      const when = run.at ? ` at ${formatTime(run.at)}` : '';
      return RUN_SUCCEEDED.has(run.status)
        ? `Runbook "${run.name}" ran and succeeded${when}${run.recoveryOutcome === 'RESOLVED' ? '; recovery was verified' : ''}.`
        : `Runbook "${run.name}" was tried${when} and did not succeed.`;
    });
  const resolution = runLines.length ? runLines.join('\n') : base.resolution;

  const lessonLines: string[] = [];
  const recurrence = evidence.recurrence;
  if (recurrence && recurrence.occurrences >= 2) {
    lessonLines.push(
      `This problem was seen ${recurrence.occurrences}${recurrence.capped ? '+' : ''} times in ${recurrence.windowDays} days.` +
        (!recurrence.lastPostmortem
          ? ' No earlier occurrence has a postmortem.'
          : recurrence.lastPostmortem.title
            ? ` Last postmortem: "${clip(recurrence.lastPostmortem.title, 120)}".`
            : ' An earlier occurrence has a postmortem.') +
        (recurrence.openActionItemCount > 0
          ? ` ${recurrence.openActionItemCount} action item${recurrence.openActionItemCount === 1 ? '' : 's'} from earlier occurrences ${recurrence.openActionItemCount === 1 ? 'is' : 'are'} still open.`
          : '')
    );
  }
  for (const similar of evidence.similarFixes.slice(0, EVIDENCE_LIMITS.causes))
    lessonLines.push(
      `A similar incident ("${clip(similar.title, 100)}") was fixed by: ${clip(similar.fix, 200)}`
    );
  const lessons = lessonLines.length
    ? lessonLines.map((line, index) => `${index + 1}. ${line}`).join('\n')
    : base.lessons;

  return { ...base, timeline, rootCause, resolution, lessons };
}

export type SuggestionSource = 'ACCEPTED_CAUSE' | 'SIMILAR_FIX' | 'RUNBOOK';

export interface ActionItemSuggestion {
  key: string;
  title: string;
  description: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  source: SuggestionSource;
  /** An open action item that already covers this; the editor links to it instead of adding a copy. */
  duplicateOf: ExistingActionItem | null;
}

export interface ExistingActionItem {
  id: string;
  title: string;
  /** Set for items from an earlier occurrence; absent for items already in this postmortem. */
  incidentId?: string;
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'not',
  'our',
  'all',
  'any',
  'add',
  'make',
  'use',
  'new',
  'into',
  'its',
  'has',
  'have',
  'can',
  'will',
  'should',
]);

const titleTokens = (title: string): Set<string> =>
  new Set(
    (title.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(word => !STOP_WORDS.has(word))
  );

/**
 * The open action item that already covers `title`, if any: the same words in any order, or most of the
 * words of the shorter title contained in the longer one. Deterministic word overlap, no model.
 */
export function findDuplicateActionItem<T extends { title: string }>(
  title: string,
  existing: readonly T[]
): T | null {
  const wanted = titleTokens(title);
  if (wanted.size === 0) return null;
  for (const item of existing) {
    const have = titleTokens(item.title);
    if (have.size === 0) continue;
    let shared = 0;
    for (const word of wanted) if (have.has(word)) shared += 1;
    const union = wanted.size + have.size - shared;
    const smaller = Math.min(wanted.size, have.size);
    if (shared / union >= 0.6 || (smaller >= 3 && shared / smaller >= 0.8)) return item;
  }
  return null;
}

const CAUSE_ACTION: Record<string, (subject: string) => { title: string; description: string }> = {
  DEPLOY: subject => ({
    title: `Add a pre-release check or canary for ${subject}`,
    description:
      'A deploy was confirmed as the cause. Catch this class of change before it reaches everyone.',
  }),
  CONFIG: subject => ({
    title: `Validate and stage configuration changes for ${subject}`,
    description:
      'A configuration change was confirmed as the cause. Add validation and a staged rollout.',
  }),
  FEATURE_FLAG: subject => ({
    title: `Roll out feature flags gradually for ${subject}`,
    description:
      'A feature flag change was confirmed as the cause. Use a gradual rollout with a tested kill switch.',
  }),
  INFRA: subject => ({
    title: `Review the infrastructure change procedure for ${subject}`,
    description:
      'An infrastructure change was confirmed as the cause. Add a pre-check and a rollback plan.',
  }),
};

/**
 * Follow-ups worth proposing, from causes responders confirmed, fixes that worked on similar incidents and
 * runbooks that failed. Each is checked against the action items already open (in this postmortem and from
 * earlier occurrences); a match is returned as `duplicateOf` and never proposed twice.
 */
export function suggestActionItems(
  evidence: PostmortemEvidence,
  existing: readonly ExistingActionItem[]
): ActionItemSuggestion[] {
  const proposals: Array<Omit<ActionItemSuggestion, 'duplicateOf'>> = [];
  for (const change of evidence.changes.filter(item => item.accepted)) {
    const build = CAUSE_ACTION[change.kind];
    if (!build) continue;
    const text = build(change.serviceName ?? 'this service');
    proposals.push({
      key: `cause-change-${change.id}`,
      title: text.title,
      description: `${text.description} Cause: ${clip(change.summary, 200)}.`,
      priority: 'HIGH',
      source: 'ACCEPTED_CAUSE',
    });
  }
  for (const incident of evidence.upstreamIncidents.filter(item => item.accepted)) {
    proposals.push({
      key: `cause-upstream-${incident.incidentId}`,
      title: `Add a safeguard for failures of ${incident.serviceName}`,
      description: `An upstream incident ("${clip(incident.title, 160)}") was confirmed as the cause. Add a timeout, fallback or earlier alert on this dependency.`,
      priority: 'HIGH',
      source: 'ACCEPTED_CAUSE',
    });
  }
  for (const run of evidence.runbookRuns.filter(item => RUN_FAILED.has(item.status))) {
    proposals.push({
      key: `runbook-${run.id}`,
      title: `Fix runbook "${clip(run.name, 80)}"`,
      description:
        'The runbook was run during this incident and did not succeed. Find out why and correct it.',
      priority: 'MEDIUM',
      source: 'RUNBOOK',
    });
  }
  for (const similar of evidence.similarFixes) {
    proposals.push({
      key: `similar-${similar.incidentId}`,
      title: `Make the known fix permanent: ${clip(similar.fix, 80)}`,
      description: `"${clip(similar.title, 160)}" was fixed the same way. Automate it or remove the cause so it is not needed again.`,
      priority: 'MEDIUM',
      source: 'SIMILAR_FIX',
    });
  }

  const suggestions: ActionItemSuggestion[] = [];
  for (const proposal of proposals) {
    // Proposals share a template, so only an identical title is a repeat; word overlap is for people's titles.
    if (suggestions.some(item => item.title === proposal.title)) continue;
    suggestions.push({
      ...proposal,
      duplicateOf: findDuplicateActionItem(proposal.title, existing),
    });
    if (suggestions.length === EVIDENCE_LIMITS.suggestions) break;
  }
  return suggestions;
}
