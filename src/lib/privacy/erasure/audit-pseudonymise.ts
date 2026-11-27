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
}): RegExp | null {
  const parts = [
    ...input.emails.map(value => ({ value, pattern: escapeRegExp(value) })),
    ...input.phones
      .filter(value => value.length >= MIN_PHONE_LENGTH)
      .map(value => ({ value, pattern: escapeRegExp(value) })),
    ...input.names
      .filter(value => value.length >= MIN_NAME_LENGTH)
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

/** Pages through rows by id, rewrites the ones the matcher changes, and returns how many changed. */
async function scrubTextRows(
  fetchPage: (after: string | undefined) => Promise<TextRow[]>,
  write: (ids: string[], texts: string[]) => Promise<unknown>,
  matcher: RegExp
): Promise<number> {
  let after: string | undefined;
  let changed = 0;
  for (;;) {
    const page: TextRow[] = await fetchPage(after);
    if (page.length === 0) return changed;
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
}

/**
 * Replaces the subject's email, name and phone number in incident free text: the content of the
 * notes they wrote, and every timeline event that names them (a timeline event has no author
 * column, so the text is the only link, e.g. "Note added via Slack ChatOps by <name>"). Call inside
 * the erasure transaction before the notes are detached. Incidents under a legal hold are left as
 * they are. Idempotent. Text other people wrote about the subject in their own notes is not
 * attributable and stays (manual review in policy.ts).
 */
export async function pseudonymiseSubjectIncidentText(
  tx: Prisma.TransactionClient,
  subject: ErasureSubjectIdentity
): Promise<{ notes: number; events: number }> {
  const email = subject.email?.toLowerCase() ?? null;
  const phone = subject.phoneNumber?.trim() ?? '';
  const name = subject.name?.trim() ?? '';
  const matcher = buildIdentifierMatcher({
    emails: email ? [email] : [],
    phones: phone ? [phone] : [],
    names: name ? [name] : [],
    ips: [],
  });
  if (!matcher) return { notes: 0, events: 0 };

  const held = await getHeldIncidentIds(tx);
  const outsideHold = held.length ? { incidentId: { notIn: held } } : {};
  const afterCursor = (after: string | undefined) => (after ? { id: { gt: after } } : {});
  // The database narrows to rows that contain the text at all; the matcher decides what changes.
  const needles = [
    email,
    phone.length >= MIN_PHONE_LENGTH ? phone : '',
    name.length >= MIN_NAME_LENGTH ? name : '',
  ]
    .filter((needle): needle is string => Boolean(needle))
    .map(needle => ({ message: { contains: needle, mode: 'insensitive' as const } }));

  const notes = await scrubTextRows(
    async after =>
      (
        await tx.incidentNote.findMany({
          where: { AND: [{ userId: subject.id }, outsideHold, afterCursor(after)] },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          select: { id: true, content: true },
        })
      ).map(row => ({ id: row.id, text: row.content })),
    (ids, texts) => tx.$executeRaw`
      UPDATE "IncidentNote" AS t SET content = u.text
      FROM unnest(${ids}::text[], ${texts}::text[]) AS u(id, text) WHERE t.id = u.id
    `,
    matcher
  );
  const events =
    needles.length === 0
      ? 0
      : await scrubTextRows(
          async after =>
            (
              await tx.incidentEvent.findMany({
                where: { AND: [{ OR: needles }, outsideHold, afterCursor(after)] },
                orderBy: { id: 'asc' },
                take: BATCH_SIZE,
                select: { id: true, message: true },
              })
            ).map(row => ({ id: row.id, text: row.message })),
          (ids, texts) => tx.$executeRaw`
            UPDATE "IncidentEvent" AS t SET message = u.text
            FROM unnest(${ids}::text[], ${texts}::text[]) AS u(id, text) WHERE t.id = u.id
          `,
          matcher
        );
  return { notes, events };
}
