/**
 * What page the assistant is opened on, derived from the URL only. The server reads the entity under the
 * person's own permissions or ignores it, so a wrong or crafted id grants nothing.
 *
 * Both the desktop routes (`/services/x`) and the mobile routes (`/m/services/x`) are recognised.
 */

export type SquirePageKind =
  | 'service'
  | 'team'
  | 'schedule'
  | 'runbook'
  | 'alert'
  | 'change'
  | 'postmortem'
  | 'escalation_policy'
  | 'status_page';
export type SquirePageContext = { kind: SquirePageKind; id: string };

const INCIDENT = /^(?:\/m)?\/incidents\/([A-Za-z0-9_-]{1,64})(?:\/|$)/;
const ENTITY =
  /^(?:\/m)?\/(services|teams|schedules|runbooks|alerts|changes|postmortems|policies)\/([A-Za-z0-9_-]{1,64})(?:\/|$)/;
/** Status pages are edited only on the desktop settings page; there is no mobile route for one. */
const STATUS_PAGE = /^\/settings\/status-pages\/([A-Za-z0-9_-]{1,64})(?:\/|$)/;

/** Path segments that are pages of their own, not entity ids. */
const RESERVED = new Set(['new', 'create', 'agents', 'executions', 'health', 'compare']);

const KINDS: Record<string, SquirePageKind> = {
  services: 'service',
  teams: 'team',
  schedules: 'schedule',
  runbooks: 'runbook',
  alerts: 'alert',
  changes: 'change',
  postmortems: 'postmortem',
  policies: 'escalation_policy',
};

export function incidentIdFromPath(pathname: string | null | undefined): string | undefined {
  const match = pathname?.match(INCIDENT);
  return match && !RESERVED.has(match[1]) ? match[1] : undefined;
}

export function pageContextFromPath(
  pathname: string | null | undefined
): SquirePageContext | undefined {
  const statusPage = pathname?.match(STATUS_PAGE);
  if (statusPage) return { kind: 'status_page', id: statusPage[1] };
  const match = pathname?.match(ENTITY);
  if (!match || RESERVED.has(match[2])) return undefined;
  const kind = KINDS[match[1]];
  return kind ? { kind, id: match[2] } : undefined;
}

/** What the assistant's context chip says about the page it was opened on. */
export type SquireContextSubject = 'incident' | SquirePageKind;
export interface SquireContextDescription {
  subject: SquireContextSubject | 'general';
  /** The chip's text, for example "Discussing this service". */
  label: string;
}

/**
 * The context the assistant has on this page, in words. An incident wins over any other entity, the
 * same order the request uses. Without either the conversation is general.
 */
export function describeSquireContext(
  pathname: string | null | undefined
): SquireContextDescription {
  const subject: SquireContextSubject | undefined = incidentIdFromPath(pathname)
    ? 'incident'
    : pageContextFromPath(pathname)?.kind;
  if (!subject) return { subject: 'general', label: 'General conversation' };
  return { subject, label: `Discussing this ${subject.replace('_', ' ')}` };
}
