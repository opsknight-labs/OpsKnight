import type { Prisma } from '@prisma/client';
import {
  auditRowsOutsideHeldUsers,
  getHeldIncidentIds,
  getHeldUserIds,
} from '@/lib/retention/lifecycle';

/**
 * Erasure keeps the subject's audit rows (GDPR Art. 17(3) retention) but pseudonymises them:
 * the IP address is cleared and the subject's identifiers inside `details` are replaced.
 * Rows only mention the subject in someone else's free text are not attributable, so they
 * are not touched (documented in policy.ts).
 */
export const ERASED = '[erased]';

const BATCH_SIZE = 500;
const MIN_NAME_LENGTH = 3;
const MIN_PHONE_LENGTH = 5;
// Free text (notes, timeline lines) is shared with other people, so a name only counts there when
// it is a full name: one word such as "Admin" would rewrite other people's text.
const MIN_FREE_TEXT_NAME_LENGTH = 5;

/**
 * Bounds that keep the incident text scrub inside the erasure transaction's time budget: the
 * timeline scan only looks at incidents the subject touched (at most this many, newest first), and
 * each of the note and timeline scans examines at most this many rows per run. Anything past a
 * bound is left as it is and the run reports `truncated`.
 */
export const MAX_ERASURE_INCIDENTS = 1000;
export const MAX_ERASURE_TEXT_ROWS = 5000;

export interface ErasureSubjectIdentity {
  id: string;
  email: string | null;
  name?: string | null;
  phoneNumber?: string | null;
}

/** Rows the subject performed, or whose email they were keyed by: identifiers and IP are theirs. */
export function subjectAuditOwnWhere(
  subjectId: string,
  email: string | null
): Prisma.AuditLogWhereInput {
  return {
    OR: [
      { actorId: subjectId },
      ...(email
        ? [
            { actorEmail: email },
            { targetEmail: email },
            { entityId: { equals: email, mode: 'insensitive' as const } },
          ]
        : []),
    ],
  };
}

/** Rows about the subject's account (an admin acted on it): their details name the subject, the IP is the admin's. */
export function subjectAuditAboutWhere(subjectId: string): Prisma.AuditLogWhereInput {
  return { entityType: 'USER', entityId: subjectId };
}

/** Every row erasure pseudonymises for the subject; the preview counts the same rows. */
export function subjectAuditRowsWhere(
  subjectId: string,
  email: string | null
): Prisma.AuditLogWhereInput {
  return { OR: [subjectAuditOwnWhere(subjectId, email), subjectAuditAboutWhere(subjectId)] };
}

export const isFreeTextName = (name: string) =>
  name.length >= MIN_FREE_TEXT_NAME_LENGTH && /\s/.test(name);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One case-insensitive matcher for everything that identifies the subject. Emails and phone
 * numbers match anywhere in a string; IPs and names only as whole tokens, so 1.2.3.4 does not
 * eat 11.2.3.45 and a short name does not eat the middle of a word.
 */
export function buildIdentifierMatcher(input: {
  emails: readonly string[];
  phones: readonly string[];
  names: readonly string[];
  ips: readonly string[];
  /** Free text other people share: a name must be a full name (a space, 5+ characters). */
  freeText?: boolean;
}): RegExp | null {
  const parts = [
    // The leading boundary keeps "alice@x.com" from eating the tail of "malice@x.com".
    ...input.emails.map(value => ({
      value,
      pattern: `(?<![\\w.+-])${escapeRegExp(value)}`,
    })),
    ...input.phones
      .filter(value => value.length >= MIN_PHONE_LENGTH)
      .map(value => ({ value, pattern: escapeRegExp(value) })),
    ...input.names
      .filter(value => (input.freeText ? isFreeTextName(value) : value.length >= MIN_NAME_LENGTH))
      .map(value => ({
        value,
        pattern: `(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`,
      })),
    ...input.ips.map(value => ({
      value,
      pattern: `(?<![\\w:.])${escapeRegExp(value)}(?![\\w:])(?!\\.\\d)`,
    })),
  ].filter(part => part.value.length > 0);
  if (parts.length === 0) return null;
  // Longest first, so "alice@example.com" wins over a name or token inside it.
  parts.sort((a, b) => b.value.length - a.value.length);
  // eslint-disable-next-line security/detect-non-literal-regexp -- every identifier is escaped by escapeRegExp above
  return new RegExp(parts.map(part => part.pattern).join('|'), 'giu');
}

/** Replaces the subject's identifiers in every string value; keys, structure and other values stay. */
export function scrubJsonIdentifiers(
  value: unknown,
  matcher: RegExp
): { value: unknown; changed: boolean } {
  if (typeof value === 'string') {
    // Split on the marker so a second run (or a name that appears in "[erased]") never grows it.
    const next = value
      .split(ERASED)
      .map(part => part.replace(matcher, ERASED))
      .join(ERASED);
    return { value: next, changed: next !== value };
  }
  if (Array.isArray(value)) {
    const items = value.map(item => scrubJsonIdentifiers(item, matcher));
    return { value: items.map(item => item.value), changed: items.some(item => item.changed) };
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).map(
      ([key, item]) => [key, scrubJsonIdentifiers(item, matcher)] as const
    );
    return {
      value: Object.fromEntries(entries.map(([key, item]) => [key, item.value])),
      changed: entries.some(([, item]) => item.changed),
    };
  }
  return { value, changed: false };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/**
 * Clears the IP and scrubs the identifiers in `details` on the subject's audit rows. Call inside
 * the destructive erasure transaction, after the subject's hold check and before the identifier
 * columns are nulled and the user row is deleted (the rows are found through them). Idempotent:
 * a second run finds nothing left to change.
 *
 * Rows a legal hold protects (another held user's account, or rows a held user performed) are
 * left as they are. The hold ids are read inside the serializable transaction, so a hold created
 * concurrently makes one side retry.
 */
export async function pseudonymiseSubjectAuditRows(
  tx: Prisma.TransactionClient,
  subject: ErasureSubjectIdentity
): Promise<{ rows: number; detailsScrubbed: number; ipCleared: number }> {
  const email = subject.email?.toLowerCase() ?? null;
  const own = subjectAuditOwnWhere(subject.id, email);
  const unprotected = auditRowsOutsideHeldUsers(await getHeldUserIds(tx));

  // IPs seen on the subject's rows also identify them inside other rows' details.
  const ipRows = await tx.auditLog.findMany({
    where: { AND: [own, { ip: { not: null } }] },
    distinct: ['ip'],
    select: { ip: true },
  });
  const matcher = buildIdentifierMatcher({
    emails: email ? [email] : [],
    phones: subject.phoneNumber ? [subject.phoneNumber.trim()] : [],
    names: subject.name ? [subject.name.trim()] : [],
    ips: ipRows.flatMap(row => (row.ip ? [row.ip] : [])),
  });

  const rows = await tx.auditLog.findMany({
    where: { AND: [subjectAuditRowsWhere(subject.id, email), unprotected] },
    select: { id: true },
  });
  const ids = [...new Set(rows.map(row => row.id))];

  let detailsScrubbed = 0;
  for (const chunk of matcher ? chunks(ids, BATCH_SIZE) : []) {
    const batch = await tx.auditLog.findMany({
      where: { id: { in: chunk } },
      select: { id: true, details: true },
    });
    const changedIds: string[] = [];
    const documents: string[] = [];
    for (const row of batch) {
      if (row.details === null || !matcher) continue;
      const scrubbed = scrubJsonIdentifiers(row.details, matcher);
      if (!scrubbed.changed) continue;
      changedIds.push(row.id);
      documents.push(JSON.stringify(scrubbed.value));
    }
    if (changedIds.length === 0) continue;
    await tx.$executeRaw`
      UPDATE "AuditLog" AS a
      SET details = u.details::jsonb
      FROM unnest(${changedIds}::text[], ${documents}::text[]) AS u(id, details)
      WHERE a.id = u.id
    `;
    detailsScrubbed += changedIds.length;
  }

  const cleared = await tx.auditLog.updateMany({
    where: { AND: [own, unprotected] },
    data: { ip: null },
  });
  return { rows: ids.length, detailsScrubbed, ipCleared: cleared.count };
}

type TextRow = { id: string; text: string };

/**
 * Pages through rows by id, rewrites the ones the matcher changes, and examines at most `limit`
 * rows. Reports `truncated` when rows were left unexamined.
 */
async function scrubTextRows(
  fetchPage: (after: string | undefined, take: number) => Promise<TextRow[]>,
  write: (ids: string[], texts: string[]) => Promise<unknown>,
  matcher: RegExp,
  limit: number
): Promise<{ changed: number; truncated: boolean }> {
  let after: string | undefined;
  let changed = 0;
  let examined = 0;
  while (examined < limit) {
    const page: TextRow[] = await fetchPage(after, Math.min(BATCH_SIZE, limit - examined));
    if (page.length === 0) return { changed, truncated: false };
    examined += page.length;
    after = page[page.length - 1].id;
    const ids: string[] = [];
    const texts: string[] = [];
    for (const row of page) {
      const scrubbed = scrubJsonIdentifiers(row.text, matcher);
      if (!scrubbed.changed) continue;
      ids.push(row.id);
      texts.push(String(scrubbed.value));
    }
    if (ids.length === 0) continue;
    await write(ids, texts);
    changed += ids.length;
  }
  return { changed, truncated: (await fetchPage(after, 1)).length > 0 };
}

/**
 * Incidents the subject took part in: they wrote a note, were the assignee or the one who
 * acknowledged, watched it, held an incident role, or were added to its war room. A timeline event
 * has no author column, so these are the only incidents whose events can name them. Newest first,
 * at most MAX_ERASURE_INCIDENTS.
 */
async function subjectIncidentIds(
  tx: Prisma.TransactionClient,
  subjectId: string
): Promise<{ ids: string[]; truncated: boolean }> {
  const take = MAX_ERASURE_INCIDENTS + 1;
  const byIncident = { orderBy: { incidentId: 'desc' as const }, take };
  const notes = await tx.incidentNote.groupBy({
    by: ['incidentId'],
    where: { userId: subjectId },
    ...byIncident,
  });
  const incidents = await tx.incident.findMany({
    where: { OR: [{ assigneeId: subjectId }, { acknowledgedById: subjectId }] },
    select: { id: true },
    orderBy: { id: 'desc' },
    take,
  });
  const watching = await tx.incidentWatcher.findMany({
    where: { userId: subjectId },
    select: { incidentId: true },
    ...byIncident,
  });
  const roles = await tx.incidentRoleAssignment.findMany({
    where: { userId: subjectId },
    select: { incidentId: true },
    ...byIncident,
  });
  const warRooms = await tx.warRoomParticipant.findMany({
    where: { userId: subjectId },
    select: { warRoom: { select: { incidentId: true } } },
    take,
  });
  const all = [
    ...notes.map(row => row.incidentId),
    ...incidents.map(row => row.id),
    ...watching.map(row => row.incidentId),
    ...roles.map(row => row.incidentId),
    ...warRooms.map(row => row.warRoom.incidentId),
  ];
  const ids = [...new Set(all)].sort().reverse();
  return { ids: ids.slice(0, MAX_ERASURE_INCIDENTS), truncated: ids.length > MAX_ERASURE_INCIDENTS };
}

/**
 * Replaces the subject's email, name and phone number in incident free text: the content of the
 * notes they wrote, and the timeline events that name them on incidents they took part in (a
 * timeline event has no author column, so the text is the only link, e.g. "Note added via Slack
 * ChatOps by <name>"). Call inside the erasure transaction before the notes are detached.
 *
 * The work is bounded so the transaction finishes on a large install (see MAX_ERASURE_INCIDENTS and
 * MAX_ERASURE_TEXT_ROWS; `truncated` reports a bound that was hit). In notes and events a name is
 * replaced only when it is a full name (a space, 5+ characters) and an email only when it is not the
 * tail of a longer address. Incidents under a legal hold are left as they are. Idempotent. Text other
 * people wrote about the subject in their own notes is not attributable and stays (manual review in
 * policy.ts).
 */
export async function pseudonymiseSubjectIncidentText(
  tx: Prisma.TransactionClient,
  subject: ErasureSubjectIdentity
): Promise<{ notes: number; events: number; truncated: boolean }> {
  const email = subject.email?.toLowerCase() ?? null;
  const phone = subject.phoneNumber?.trim() ?? '';
  const name = subject.name?.trim() ?? '';
  const matcher = buildIdentifierMatcher({
    emails: email ? [email] : [],
    phones: phone ? [phone] : [],
    names: name ? [name] : [],
    ips: [],
    freeText: true,
  });
  if (!matcher) return { notes: 0, events: 0, truncated: false };

  const held = await getHeldIncidentIds(tx);
  const afterCursor = (after: string | undefined) => (after ? { id: { gt: after } } : {});
  // The database narrows to rows that contain the text at all; the matcher decides what changes.
  const needles = [
    email,
    phone.length >= MIN_PHONE_LENGTH ? phone : '',
    isFreeTextName(name) ? name : '',
  ]
    .filter((needle): needle is string => Boolean(needle))
    .map(needle => ({ message: { contains: needle, mode: 'insensitive' as const } }));

  const notes = await scrubTextRows(
    async (after, take) =>
      (
        await tx.incidentNote.findMany({
          where: {
            AND: [
              { userId: subject.id },
              held.length ? { incidentId: { notIn: held } } : {},
              afterCursor(after),
            ],
          },
          orderBy: { id: 'asc' },
          take,
          select: { id: true, content: true },
        })
      ).map(row => ({ id: row.id, text: row.content })),
    (ids, texts) => tx.$executeRaw`
      UPDATE "IncidentNote" AS t SET content = u.text
      FROM unnest(${ids}::text[], ${texts}::text[]) AS u(id, text) WHERE t.id = u.id
    `,
    matcher,
    MAX_ERASURE_TEXT_ROWS
  );
  const touched = needles.length === 0 ? null : await subjectIncidentIds(tx, subject.id);
  const incidentIds = touched?.ids.filter(id => !held.includes(id)) ?? [];
  const events =
    incidentIds.length === 0
      ? { changed: 0, truncated: false }
      : await scrubTextRows(
          async (after, take) =>
            (
              await tx.incidentEvent.findMany({
                where: {
                  AND: [{ incidentId: { in: incidentIds } }, { OR: needles }, afterCursor(after)],
                },
                orderBy: { id: 'asc' },
                take,
                select: { id: true, message: true },
              })
            ).map(row => ({ id: row.id, text: row.message })),
          (ids, texts) => tx.$executeRaw`
            UPDATE "IncidentEvent" AS t SET message = u.text
            FROM unnest(${ids}::text[], ${texts}::text[]) AS u(id, text) WHERE t.id = u.id
          `,
          matcher,
          MAX_ERASURE_TEXT_ROWS
        );
  return {
    notes: notes.changed,
    events: events.changed,
    truncated: notes.truncated || events.truncated || Boolean(touched?.truncated),
  };
}
