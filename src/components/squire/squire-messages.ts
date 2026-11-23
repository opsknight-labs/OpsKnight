import { deriveOnCall, type StatusBarShift } from '@/lib/status-bar';
import { answerReadyLine, formatLead, intro, type Tone } from './squire-voice';

/**
 * What Squire brings to the person in his speech bubble on the status bar: a one-time introduction, on-call
 * heads-ups and "your answer is ready". Incident alerts are not repeated here; the incident banner and
 * toasts already own them.
 */
export type SquireNote = {
  id: string;
  /** A heading; only the introduction has one. */
  title?: string;
  text: string;
  /** Questions offered as one-click buttons; each opens the chat and asks it. */
  asks?: string[];
  /** How long a delivered note stays delivered: this browser for good, this tab session, or this page. */
  keep: 'forever' | 'session' | 'page';
  action?: { label: string; href: string } | { label: string; open: true };
  dismissLabel: string;
};

/** A heads-up before a shift starts, and before a real handoff (not the lookahead limit). */
export const ON_CALL_LEAD_MS = 2 * 60 * 60_000;
export const HANDOFF_LEAD_MS = 30 * 60_000;

export function buildNotes(input: {
  name: string;
  tone: Tone;
  shifts: readonly StatusBarShift[];
  now: number;
  /** Set while an answer finished with the panel closed; a new number per answer. */
  answerReady: number | null;
}): SquireNote[] {
  const notes: SquireNote[] = [
    { id: 'intro', ...intro(input.name), keep: 'forever', dismissLabel: 'Later' },
  ];
  if (input.answerReady !== null)
    notes.push({
      id: `ready:${input.answerReady}`,
      text: answerReadyLine(input.tone),
      keep: 'page',
      action: { label: 'Read it', open: true },
      dismissLabel: 'Later',
    });
  const state = deriveOnCall(input.shifts, input.now);
  const crisp = input.tone === 'crisp';
  if (state?.kind === 'off') {
    const lead = Date.parse(state.next) - input.now;
    if (lead > 0 && lead <= ON_CALL_LEAD_MS)
      notes.push({
        id: `on-call:${state.scheduleId}:${state.next}`,
        text: crisp
          ? `On call for ${state.scheduleName} in ${formatLead(lead)}.`
          : `Heads up: your ${state.scheduleName} shift starts in ${formatLead(lead)}.`,
        keep: 'session',
        action: { label: 'View schedule', href: `/schedules/${state.scheduleId}` },
        dismissLabel: 'Got it',
      });
  } else if (state?.kind === 'on' && state.until) {
    const lead = Date.parse(state.until) - input.now;
    if (lead > 0 && lead <= HANDOFF_LEAD_MS)
      notes.push({
        id: `handoff:${state.scheduleId}:${state.until}`,
        text: crisp
          ? `Your ${state.scheduleName} shift ends in ${formatLead(lead)}.`
          : `Your ${state.scheduleName} shift ends in ${formatLead(lead)}. Good time to prep the handoff.`,
        keep: 'session',
        action: { label: 'View schedule', href: `/schedules/${state.scheduleId}` },
        dismissLabel: 'Got it',
      });
  }
  return notes;
}

/** When the next on-call note becomes due, so the clock wakes exactly then instead of polling. */
export function nextNoteAt(shifts: readonly StatusBarShift[], now: number): number | null {
  const moments = shifts.flatMap(shift => [
    Date.parse(shift.start) - ON_CALL_LEAD_MS,
    Date.parse(shift.start),
    ...(shift.endClamped ? [] : [Date.parse(shift.end) - HANDOFF_LEAD_MS, Date.parse(shift.end)]),
  ]);
  const future = moments.filter(at => Number.isFinite(at) && at > now);
  return future.length ? Math.min(...future) : null;
}

const FOREVER_KEY = 'opsknight.squire.delivered';
const SESSION_KEY = 'opsknight.squire.delivered.session';
const pageDelivered = new Set<string>();

function readSet(storage: () => Storage, key: string): Set<string> {
  try {
    const raw = storage().getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function isDelivered(note: Pick<SquireNote, 'id' | 'keep'>): boolean {
  if (pageDelivered.has(note.id)) return true;
  if (note.keep === 'forever') return readSet(() => window.localStorage, FOREVER_KEY).has(note.id);
  if (note.keep === 'session')
    return readSet(() => window.sessionStorage, SESSION_KEY).has(note.id);
  return false;
}

// shortcut: delivery is remembered per browser, not per user; move to User.preferences if people see the intro twice.
export function markDelivered(note: Pick<SquireNote, 'id' | 'keep'>): void {
  pageDelivered.add(note.id);
  if (note.keep === 'page') return;
  const [storage, key] =
    note.keep === 'forever'
      ? [() => window.localStorage, FOREVER_KEY]
      : [() => window.sessionStorage, SESSION_KEY];
  try {
    // Session notes are per shift, so only the latest few matter.
    const ids = [...readSet(storage, key), note.id].slice(-50);
    storage().setItem(key, JSON.stringify(ids));
  } catch {
    // Storage can be blocked; the note is then remembered for this page only.
  }
}
