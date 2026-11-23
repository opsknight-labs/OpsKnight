import 'server-only';
import prisma from '@/lib/prisma';
import { AuthorizationError } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere, scheduleReadWhere } from '@/lib/authorization-filters';
import { CATCH_UP_DEFAULT_HOURS, CATCH_UP_MAX_HOURS, getCatchUp } from '@/lib/oncall-catch-up';
import { getMyOnCallShifts } from '@/lib/oncall-my-shifts';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import { redactSecrets } from '../ai/redact';
import type { EvidenceSnapshot } from './evidence';

/**
 * "Catch me up": a shift hand-off for the person asking. What opened, resolved and is still open on their
 * teams and assigned to them since their last on-call shift ended (or a window they name: 12 hours by default,
 * at most 7 days), notes that mention them, and their next shift. Every read goes through the person's own
 * visibility rules; it changes nothing and stores nothing.
 */

const HOUR_MS = 3_600_000;
const ROWS = 5;
const NOTES = 5;
/** A turn verifies at most 32 sources in all; a catch-up leaves room for the reads that follow it. */
const MAX_EVIDENCE = 20;
const NOTE_CHARS = 280;

type Incident = {
  id: string;
  title: string;
  status: string;
  urgency: string;
  serviceName: string;
  assignedToMe: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

export interface SquireCatchUp {
  since: string;
  until: string;
  /** Why the window starts where it does. */
  basis: 'last-shift' | 'window' | 'default';
  /** The window asked for was longer than seven days and was shortened. */
  capped: boolean;
  counts: { opened: number; resolved: number; active: number };
  /** Still open (OPEN or ACKNOWLEDGED) and high urgency, newest first. */
  stillOpenHighUrgency: Incident[];
  /** Open and assigned to the person, most urgent first. */
  assignedToMe: Incident[];
  /** Opened in the window and still open. */
  opened: Incident[];
  resolved: Incident[];
  /** Incidents that paged the person in the window (their own notification history only). */
  pagedMe: Array<{ id: string; title: string; urgency: string; status: string }>;
  notesMentioningMe: Array<{
    incidentId: string;
    incidentTitle: string;
    by: string | null;
    at: string;
    text: string;
  }>;
  onCallNow: { scheduleId: string; scheduleName: string; until: string } | null;
  nextShift: { scheduleId: string; scheduleName: string; start: string; end: string } | null;
  lastShift: { scheduleId: string; scheduleName: string; end: string } | null;
  /** The person belongs to no team, so only incidents assigned to or watched by them are included. */
  noTeams: boolean;
  truncated: boolean;
}

const short = (text: string, max: number) => {
  const flat = redactSecrets(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Schedule visibility is a separate permission; without it there are simply no shifts to report. */
function schedulesFor(actor: AuthorizationActor) {
  try {
    return scheduleReadWhere(actor);
  } catch (error) {
    if (error instanceof AuthorizationError) return null;
    throw error;
  }
}

/** The end of the person's most recent finished shift in the last seven days, across schedules they can read. */
async function lastShiftEnded(
  actor: AuthorizationActor,
  readable: NonNullable<ReturnType<typeof schedulesFor>>,
  now: Date
) {
  const from = new Date(now.getTime() - CATCH_UP_MAX_HOURS * HOUR_MS);
  const schedules = await prisma.onCallSchedule.findMany({
    where: {
      AND: [
        readable,
        {
          OR: [
            { layers: { some: { users: { some: { userId: actor.id } } } } },
            { overrides: { some: { userId: actor.id, end: { gt: from }, start: { lt: now } } } },
          ],
        },
      ],
    },
    select: { id: true },
    take: 25,
  });
  if (!schedules.length) return null;
  const blocks = (
    await getWindowOnCallShifts(from, now, { id: { in: schedules.map(row => row.id) } })
  ).filter(block => block.userId === actor.id);
  // A block that runs up to `now` is the window's edge (a current shift), not an end; a block another one
  // of the person's blocks continues is not the end of the shift either.
  const ended = blocks.filter(
    block =>
      block.end.getTime() < now.getTime() &&
      block.end.getTime() > from.getTime() &&
      !blocks.some(
        next =>
          next.scheduleId === block.scheduleId &&
          next.start.getTime() <= block.end.getTime() &&
          next.end.getTime() > block.end.getTime()
      )
  );
  const last = ended.sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  return last
    ? { scheduleId: last.scheduleId, scheduleName: last.schedule.name, end: last.end }
    : null;
}

/** People's own words for them in a note: full name, email, or @first-name / @email-name. */
function mentionTerms(user: { name: string | null; email: string }): string[] {
  const name = user.name?.trim() ?? '';
  const first = name.split(/\s+/)[0] ?? '';
  const local = user.email.split('@')[0] ?? '';
  return [
    ...new Set(
      [
        name.length >= 3 ? name : '',
        user.email,
        first.length >= 3 ? `@${first}` : '',
        local.length >= 3 ? `@${local}` : '',
      ].filter(Boolean)
    ),
  ];
}

export async function buildCatchUp(
  actor: AuthorizationActor,
  input: { since?: Date; hours?: number; now?: Date } = {}
): Promise<SquireCatchUp> {
  const now = input.now ?? new Date();
  const floor = new Date(now.getTime() - CATCH_UP_MAX_HOURS * HOUR_MS);
  const readWhere = incidentReadWhere(actor);
  const schedules = schedulesFor(actor);
  const [shifts, last, user] = await Promise.all([
    schedules
      ? getMyOnCallShifts({ userId: actor.id, readWhere: schedules, now, days: 7, limit: 5 })
      : null,
    schedules && input.since === undefined && input.hours === undefined
      ? lastShiftEnded(actor, schedules, now)
      : null,
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
  ]);
  const current = shifts?.shifts.find(shift => shift.current) ?? null;
  const next = shifts?.shifts.find(shift => !shift.current) ?? null;

  let basis: SquireCatchUp['basis'] = 'default';
  let since = new Date(now.getTime() - CATCH_UP_DEFAULT_HOURS * HOUR_MS);
  if (input.since || input.hours) {
    basis = 'window';
    since = input.since ?? new Date(now.getTime() - (input.hours ?? 0) * HOUR_MS);
  } else if (last && !current) {
    basis = 'last-shift';
    since = last.end;
  }
  const capped = since < floor;
  if (capped) since = floor;
  if (since > now) since = now;

  const [catchUp, notes] = await Promise.all([
    getCatchUp({ userId: actor.id, readWhere, since, limit: ROWS, scope: 'mine', now }),
    user
      ? prisma.incidentNote.findMany({
          where: {
            createdAt: { gte: since },
            // Notes the person wrote themselves are not news to them.
            OR: [{ userId: null }, { userId: { not: actor.id } }],
            incident: { is: readWhere },
            AND: [
              {
                OR: mentionTerms(user).map(term => ({
                  content: { contains: term, mode: 'insensitive' as const },
                })),
              },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: NOTES,
          select: {
            content: true,
            createdAt: true,
            incidentId: true,
            incident: { select: { title: true } },
            user: { select: { name: true } },
          },
        })
      : [],
  ]);

  const shape = (row: (typeof catchUp.active)[number]): Incident => ({
    id: row.id,
    title: short(row.title, 160),
    status: row.status,
    urgency: row.urgency,
    serviceName: row.serviceName,
    assignedToMe: row.assignedToMe,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  });
  return {
    since: since.toISOString(),
    until: now.toISOString(),
    basis,
    capped,
    counts: catchUp.counts,
    stillOpenHighUrgency: catchUp.active.filter(row => row.urgency === 'HIGH').map(shape),
    assignedToMe: catchUp.assignedToMe.map(shape),
    opened: catchUp.active.filter(row => row.openedSinceThen).map(shape),
    resolved: catchUp.recentlyResolved.map(shape),
    pagedMe: catchUp.pagedMe.items.map(item => ({
      id: item.incident.id,
      title: short(item.incident.title, 160),
      urgency: item.incident.urgency,
      status: item.incident.status,
    })),
    notesMentioningMe: notes.map(note => ({
      incidentId: note.incidentId,
      incidentTitle: short(note.incident.title, 160),
      by: note.user?.name ?? null,
      at: note.createdAt.toISOString(),
      text: short(note.content, NOTE_CHARS),
    })),
    onCallNow: current
      ? { scheduleId: current.scheduleId, scheduleName: current.scheduleName, until: current.end }
      : null,
    nextShift: next
      ? {
          scheduleId: next.scheduleId,
          scheduleName: next.scheduleName,
          start: next.start,
          end: next.end,
        }
      : null,
    lastShift: last
      ? {
          scheduleId: last.scheduleId,
          scheduleName: last.scheduleName,
          end: last.end.toISOString(),
        }
      : null,
    noTeams: catchUp.myTeamCount === 0,
    truncated: Object.values(catchUp.truncated).some(Boolean) || notes.length === NOTES,
  };
}

/** Every record a catch-up names, so the answer can cite it. */
export function catchUpEvidence(result: SquireCatchUp): EvidenceSnapshot[] {
  const incidents = new Map<string, { id: string; title: string }>();
  for (const row of [
    ...result.stillOpenHighUrgency,
    ...result.assignedToMe,
    ...result.opened,
    ...result.resolved,
    ...result.pagedMe,
  ])
    incidents.set(row.id, row);
  for (const note of result.notesMentioningMe)
    if (!incidents.has(note.incidentId))
      incidents.set(note.incidentId, { id: note.incidentId, title: note.incidentTitle });
  const schedules = [result.onCallNow, result.nextShift, result.lastShift].filter(
    (shift): shift is NonNullable<typeof shift> => Boolean(shift)
  );
  return [
    ...[...incidents.values()].slice(0, MAX_EVIDENCE - schedules.length).map(row => ({
      kind: 'incident' as const,
      id: row.id,
      label: row.title,
      data: row,
    })),
    ...[...new Map(schedules.map(shift => [shift.scheduleId, shift])).values()].map(shift => ({
      kind: 'schedule' as const,
      id: shift.scheduleId,
      label: shift.scheduleName,
      data: shift,
    })),
  ];
}

/** Markdown-safe text: the person's data is shown, never interpreted. */
const safe = (value: string) => value.replace(/[\\`*_{}\[\]()<>|#]/g, '\\$&');

/** The basic-mode (no AI) answer: the same data, written out in the person's time zone. */
export function renderCatchUp(result: SquireCatchUp, timeZone: string): string {
  const when = (iso: string) =>
    `${new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))}`;
  const line = (row: Incident) =>
    `- **${safe(row.title)}** — ${safe(row.serviceName)}, ${row.status.toLowerCase()}, ${row.urgency.toLowerCase()} urgency${row.assignedToMe ? ', assigned to you' : ''}. /incidents/${row.id}`;
  const since =
    result.basis === 'last-shift' && result.lastShift
      ? `since your last on-call shift on ${safe(result.lastShift.scheduleName)} ended (${when(result.since)})`
      : `since ${when(result.since)}`;
  const quiet =
    result.counts.opened === 0 &&
    result.counts.resolved === 0 &&
    result.assignedToMe.length === 0 &&
    result.stillOpenHighUrgency.length === 0 &&
    result.notesMentioningMe.length === 0;
  const section = (title: string, rows: string[]) =>
    rows.length ? [`**${title}**`, ...rows].join('\n') : '';
  return [
    `## Catch-up ${since}`,
    `On your teams and assigned to you: ${result.counts.opened} opened, ${result.counts.resolved} resolved, ${result.counts.active} still open.`,
    result.capped ? 'A catch-up covers at most the last 7 days, so the window was shortened.' : '',
    result.noTeams
      ? 'You are on no team, so this covers only incidents assigned to or watched by you.'
      : '',
    quiet ? 'Nothing new needs you. It has been quiet.' : '',
    section(
      'Still open, high urgency',
      // Yours are listed under "Assigned to you"; this is the rest of the fire.
      result.stillOpenHighUrgency.filter(row => !row.assignedToMe).map(line)
    ),
    section('Assigned to you', result.assignedToMe.map(line)),
    section(
      'Opened in this window',
      result.opened.filter(row => row.urgency !== 'HIGH' && !row.assignedToMe).map(line)
    ),
    section('Resolved', result.resolved.map(line)),
    section(
      'Paged you',
      result.pagedMe.map(
        row => `- **${safe(row.title)}** — ${row.status.toLowerCase()}. /incidents/${row.id}`
      )
    ),
    section(
      'Notes that mention you',
      result.notesMentioningMe.map(
        note =>
          `- ${safe(note.by ?? 'Someone')} on **${safe(note.incidentTitle)}**, ${when(note.at)}: “${safe(note.text)}” /incidents/${note.incidentId}`
      )
    ),
    result.onCallNow
      ? `You are on call now for ${safe(result.onCallNow.scheduleName)} until ${when(result.onCallNow.until)}. /schedules/${result.onCallNow.scheduleId}`
      : result.nextShift
        ? `Your next shift: ${safe(result.nextShift.scheduleName)}, ${when(result.nextShift.start)} to ${when(result.nextShift.end)}. /schedules/${result.nextShift.scheduleId}`
        : 'You have no on-call shift in the next 7 days on schedules you can see.',
    result.truncated ? 'Some lists were shortened; open Incidents for the full view.' : '',
    `As of ${when(result.until)} (${timeZone}). Only data you can read is included.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
