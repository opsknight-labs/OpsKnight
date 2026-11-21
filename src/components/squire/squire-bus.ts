import {
  INSIGHTS_SECTIONS,
  type InsightsSectionId,
} from '@/lib/intelligence/incident-ux/strip-contract';

/**
 * Small event bridge shared with callers without importing the assistant UI.
 *
 * ## Contract
 *
 * `openSquire()` opens the panel. It accepts either a plain string (asked immediately; the original
 * form, still supported) or a {@link SquireOpenRequest}:
 *
 * | field        | effect                                                                                  |
 * | ------------ | --------------------------------------------------------------------------------------- |
 * | `message`    | Asked as soon as the panel is ready (a model or basic turn starts).                     |
 * | `question`   | Placed in the composer and focused, NOT sent. Use it for links and "Ask about this"     |
 * |              | actions where the person should confirm the wording first. Ignored when `message` is set.|
 * | `evidence`   | The item the question is about: `{ kind, id, label? }`. Shown above the composer as an  |
 * |              | "About" chip that links back to the item (`#finding-<id>` for incident findings). For a |
 * |              | whole inspector section, `id` is the incident id and the chip links to the section.     |
 * | `incidentId` | The incident the caller is showing. When it matches the page's incident the panel docks |
 * |              | beside the page on desktop, unless the person chose a display mode themselves.          |
 *
 * Example, from the incident insights inspector:
 *
 * ```ts
 * openSquire({
 *   question: 'Why is this deploy the likely cause?',
 *   evidence: { kind: 'change', id: finding.findingId, label: finding.summary },
 *   incidentId,
 * });
 * ```
 *
 * Everything in the request is treated as untrusted on arrival: {@link parseSquireOpenDetail} drops
 * wrong types, over-long text and ids that are not plain identifiers. The handle is an identifier only;
 * the server reads whatever the question refers to under the person's own permissions.
 *
 * ## Deep links
 *
 * - `?squire=open&q=<question>` on any app page opens the panel with the question in the composer
 *   (see `deep-link.ts`).
 * - `#finding-<findingId>` is the anchor an incident finding is rendered with in the insights inspector;
 *   {@link findingAnchor} and {@link findingHref} build it so every surface links the same way.
 */
/** The window event the bus dispatches; listeners that only need to know the panel was asked for use it. */
export const SQUIRE_OPEN_EVENT = 'squire:open';
const OPEN_EVENT = SQUIRE_OPEN_EVENT;

/** What an evidence handle can point at. Finding kinds mirror the insights inspector's sections. */
export const SQUIRE_EVIDENCE_KINDS = [
  'briefing',
  'triage',
  'similar',
  'related',
  'group',
  'cause',
  'change',
  'upstream',
  'runbook',
  'impact',
  'summary',
  'noise-decision',
  'timeline',
  'alert',
  'incident',
  'service',
] as const;
export type SquireEvidenceKind = (typeof SQUIRE_EVIDENCE_KINDS)[number];

export interface SquireEvidenceHandle {
  kind: SquireEvidenceKind;
  /** The finding id (or the entity id for `alert`, `incident` and `service`). */
  id: string;
  /** A short human label for the chip; never interpreted. */
  label?: string;
}

export interface SquireOpenRequest {
  message?: string;
  question?: string;
  evidence?: SquireEvidenceHandle;
  incidentId?: string;
}

/** The inspector sections (`?insights=<section>`): defined once, beside the strip's loader contract. */
export { INSIGHTS_SECTIONS };
export type InsightsSection = InsightsSectionId;

const SECTION_OF = new Map<SquireEvidenceKind, InsightsSection>([
  ['briefing', 'briefing'],
  ['triage', 'triage'],
  ['similar', 'similar'],
  ['related', 'related'],
  ['group', 'related'],
  ['cause', 'why'],
  ['change', 'why'],
  ['upstream', 'why'],
  ['runbook', 'runbooks'],
  ['impact', 'impact'],
  ['summary', 'summary'],
]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 2000;
const MAX_LABEL = 120;

/** The element id (without `#`) an incident finding is rendered with. */
export function findingAnchor(findingId: string): string {
  return `finding-${findingId}`;
}

/** The inspector section for an evidence kind, or undefined when the kind is not an incident finding. */
export function insightsSectionFor(kind: SquireEvidenceKind): InsightsSection | undefined {
  return SECTION_OF.get(kind);
}

/**
 * A shareable link to one finding of an incident: the incident page with the inspector open on the
 * finding's section and the finding's anchor (under `/m` for the mobile routes). Undefined when either
 * id is not a plain identifier.
 */
export function findingHref(
  incidentId: string,
  finding: { kind: SquireEvidenceKind; id: string },
  options: { mobile?: boolean } = {}
): string | undefined {
  if (!ID.test(incidentId) || !ID.test(finding.id)) return undefined;
  const section = insightsSectionFor(finding.kind);
  const base = `${options.mobile ? '/m' : ''}/incidents/${incidentId}${section ? `?insights=${section}` : ''}`;
  // A handle whose id is the incident's own id is about a whole section, which has no item anchor.
  return finding.id === incidentId ? base : `${base}#${findingAnchor(finding.id)}`;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
};

function parseEvidence(value: unknown): SquireEvidenceHandle | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { kind, id, label } = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !(SQUIRE_EVIDENCE_KINDS as readonly string[]).includes(kind))
    return undefined;
  if (typeof id !== 'string' || !ID.test(id)) return undefined;
  const shown = text(label, MAX_LABEL);
  return { kind: kind as SquireEvidenceKind, id, ...(shown ? { label: shown } : {}) };
}

/** Reads an open request from an event's detail, keeping only well-formed fields. */
export function parseSquireOpenDetail(detail: unknown): SquireOpenRequest {
  if (!detail || typeof detail !== 'object') return {};
  const raw = detail as Record<string, unknown>;
  const message = text(raw.message, MAX_TEXT);
  const question = message ? undefined : text(raw.question, MAX_TEXT);
  const evidence = parseEvidence(raw.evidence);
  const incidentId =
    typeof raw.incidentId === 'string' && ID.test(raw.incidentId) ? raw.incidentId : undefined;
  return {
    ...(message ? { message } : {}),
    ...(question ? { question } : {}),
    ...(evidence ? { evidence } : {}),
    ...(incidentId ? { incidentId } : {}),
  };
}

let queuedOpen: SquireOpenRequest | null = null;
let listeners = 0;

export function openSquire(request?: string | SquireOpenRequest) {
  if (typeof window === 'undefined') return;
  const detail: SquireOpenRequest =
    typeof request === 'string'
      ? request
        ? { message: request }
        : {}
      : parseSquireOpenDetail(request);
  if (!listeners) queuedOpen = detail;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail }));
}

/** Replay an early click after the launcher's effects have installed its send handler. */
export function subscribeSquireOpen(onOpen: (event: Event) => void): () => void {
  window.addEventListener(OPEN_EVENT, onOpen);
  listeners += 1;
  const queued = queuedOpen;
  queuedOpen = null;
  let replayPending = Boolean(queued);
  const replay = queued
    ? window.setTimeout(() => {
        replayPending = false;
        onOpen(new CustomEvent(OPEN_EVENT, { detail: queued }));
      })
    : undefined;
  return () => {
    listeners -= 1;
    if (replay !== undefined) {
      window.clearTimeout(replay);
      // React Strict Mode may unsubscribe before the replay has run.
      if (replayPending && queued) queuedOpen = queued;
    }
    window.removeEventListener(OPEN_EVENT, onOpen);
  };
}
