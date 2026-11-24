import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { sha256 } from '../ai/digest';

/**
 * Answer feedback: a thumbs up or down with an optional short reason. Only the mode, the intent and a digest
 * of the question are stored, never the text, so quality can be tracked without keeping more content than
 * the saved conversation (if any) already does.
 */

export const FEEDBACK_REASONS = [
  // What the 👎 form offers.
  'wrong_facts',
  'missed_point',
  'too_long',
  'wrong_action',
  // Older clients and integrations.
  'wrong',
  'incomplete',
  'outdated',
  'unclear',
  'unsafe',
  'helpful',
  'other',
] as const;

export const feedbackInputSchema = z
  .object({
    rating: z.enum(['UP', 'DOWN']),
    mode: z.enum(['ai', 'basic']),
    intent: z
      .string()
      .regex(/^[A-Z_]{2,40}$/)
      .optional(),
    reason: z.enum(FEEDBACK_REASONS).optional(),
    note: z.string().trim().max(300).optional(),
    question: z.string().max(2_000).optional(),
    conversationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    /** The page the answer was asked on. Kept only when the person can still read it (re-checked here). */
    incidentId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    serviceId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

/**
 * The incident and service the rated answer was about, read under the person's own permissions. An id they
 * cannot read is dropped without saying so; an incident's own service wins over a claimed one.
 */
async function readableSubject(
  actor: AuthorizationActor,
  input: Pick<FeedbackInput, 'incidentId' | 'serviceId'>
): Promise<{ incidentId: string | null; serviceId: string | null }> {
  try {
    const incident = input.incidentId
      ? await prisma.incident.findFirst({
          where: { AND: [{ id: input.incidentId }, incidentReadWhere(actor)] },
          select: { id: true, serviceId: true },
        })
      : null;
    if (incident) return { incidentId: incident.id, serviceId: incident.serviceId };
    const service = input.serviceId
      ? await prisma.service.findFirst({
          where: { AND: [{ id: input.serviceId }, serviceReadWhere(actor)] },
          select: { id: true },
        })
      : null;
    return { incidentId: null, serviceId: service?.id ?? null };
  } catch {
    // A scope that cannot be built (inactive actor) keeps the rating but no subject.
    return { incidentId: null, serviceId: null };
  }
}

/** Stores one rating. Without `actor` the incident and service are not kept (nothing to re-check them with). */
export async function recordFeedback(
  userId: string,
  input: FeedbackInput,
  actor?: AuthorizationActor
): Promise<string> {
  const subject = actor
    ? await readableSubject(actor, input)
    : { incidentId: null, serviceId: null };
  const row = await prisma.squireFeedback.create({
    data: {
      userId,
      ...subject,
      conversationId: input.conversationId ?? null,
      mode: input.mode,
      intent: input.intent ?? null,
      rating: input.rating,
      reason: [input.reason, input.note].filter(Boolean).join(': ').slice(0, 500) || null,
      questionHash: input.question ? sha256(input.question) : null,
    },
    select: { id: true },
  });
  return row.id;
}

export interface FeedbackSummary {
  days: number;
  total: number;
  up: number;
  down: number;
  byMode: Array<{ mode: string; up: number; down: number }>;
  byIntent: Array<{ intent: string; up: number; down: number }>;
  reasons: Array<{ reason: string; count: number }>;
}

/** Aggregate ratings over the last `days`, bounded; no text and no person is returned. */
export async function getFeedbackSummary(
  days = 30,
  now: Date = new Date()
): Promise<FeedbackSummary> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.squireFeedback.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 5_000,
    select: { mode: true, intent: true, rating: true, reason: true },
  });
  const tally = <K extends string>(key: (row: (typeof rows)[number]) => K | null) => {
    const map = new Map<K, { up: number; down: number }>();
    for (const row of rows) {
      const k = key(row);
      if (!k) continue;
      const entry = map.get(k) ?? { up: 0, down: 0 };
      if (row.rating === 'UP') entry.up += 1;
      else entry.down += 1;
      map.set(k, entry);
    }
    return [...map.entries()]
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.up + b.down - (a.up + a.down));
  };
  const reasons = new Map<string, number>();
  for (const row of rows) {
    const reason = row.reason?.split(':')[0];
    if (row.rating === 'DOWN' && reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  return {
    days,
    total: rows.length,
    up: rows.filter(row => row.rating === 'UP').length,
    down: rows.filter(row => row.rating === 'DOWN').length,
    byMode: tally(row => row.mode).map(({ name, ...rest }) => ({ mode: name, ...rest })),
    byIntent: tally(row => row.intent)
      .slice(0, 12)
      .map(({ name, ...rest }) => ({ intent: name, ...rest })),
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/* --------------------------------------------------------------------------------------- admin review */

export const FEEDBACK_REVIEW_STATUSES = ['NEW', 'LEARNED', 'DISMISSED'] as const;
export type FeedbackReviewStatus = (typeof FEEDBACK_REVIEW_STATUSES)[number];

export interface FeedbackReviewItem {
  id: string;
  createdAt: Date;
  rating: string;
  mode: string;
  intent: string | null;
  /** The reason code, then the person's note after ": ". */
  reason: string | null;
  reviewStatus: string;
  hasQuestion: boolean;
  incident: { id: string; title: string } | null;
  service: { id: string; name: string } | null;
}

/**
 * Recent feedback for an intelligence administrator, newest first: rating, reason, mode, intent and the
 * incident and service it was about (named only when the reviewer can read them). Never who gave it.
 */
export async function listFeedbackForReview(
  actor: AuthorizationActor,
  options: { status?: FeedbackReviewStatus; limit?: number } = {}
): Promise<FeedbackReviewItem[]> {
  const rows = await prisma.squireFeedback.findMany({
    where: options.status ? { reviewStatus: options.status } : {},
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    select: {
      id: true,
      createdAt: true,
      rating: true,
      mode: true,
      intent: true,
      reason: true,
      reviewStatus: true,
      questionHash: true,
      incidentId: true,
      serviceId: true,
    },
  });
  const ids = <K extends 'incidentId' | 'serviceId'>(key: K) => [
    // eslint-disable-next-line security/detect-object-injection -- key is one of two literal column names
    ...new Set(rows.flatMap(row => (row[key] ? [row[key] as string] : []))),
  ];
  const [incidents, services] = await Promise.all([
    ids('incidentId').length
      ? prisma.incident.findMany({
          where: { AND: [{ id: { in: ids('incidentId') } }, incidentReadWhere(actor)] },
          select: { id: true, title: true },
        })
      : [],
    ids('serviceId').length
      ? prisma.service.findMany({
          where: { AND: [{ id: { in: ids('serviceId') } }, serviceReadWhere(actor)] },
          select: { id: true, name: true },
        })
      : [],
  ]);
  const incidentById = new Map(incidents.map(item => [item.id, item]));
  const serviceById = new Map(services.map(item => [item.id, item]));
  return rows.map(row => ({
    id: row.id,
    createdAt: row.createdAt,
    rating: row.rating,
    mode: row.mode,
    intent: row.intent,
    reason: row.reason,
    reviewStatus: row.reviewStatus,
    hasQuestion: Boolean(row.questionHash),
    incident: row.incidentId ? (incidentById.get(row.incidentId) ?? null) : null,
    service: row.serviceId ? (serviceById.get(row.serviceId) ?? null) : null,
  }));
}

/** The feedback row behind an admin action, or null. */
export async function getFeedbackForReview(id: string) {
  return prisma.squireFeedback.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      conversationId: true,
      rating: true,
      mode: true,
      intent: true,
      reason: true,
      questionHash: true,
      incidentId: true,
      serviceId: true,
      reviewStatus: true,
    },
  });
}

/** Moves one feedback row to a review state; audited with what was done, never with any text. */
export async function setFeedbackReview(
  actor: AuthorizationActor,
  id: string,
  status: Exclude<FeedbackReviewStatus, 'NEW'>,
  outcome: 'learn_candidate' | 'eval_case' | 'dismissed'
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    const updated = await tx.squireFeedback.updateMany({
      where: { id },
      data: { reviewStatus: status },
    });
    if (updated.count === 0) return false;
    await logAudit(
      {
        action: `intelligence.squire.feedback.${outcome}`,
        entityType: 'SYSTEM_CONFIG',
        entityId: id,
        actorId: actor.id,
        source: 'UI',
        details: { feedbackId: id, reviewStatus: status },
      },
      tx
    );
    return true;
  });
}

/**
 * An evaluation case built from one feedback row, in the basic (`basic-cases.ts`) or scripted
 * (`model-cases.ts`) shape. The rated question is never decrypted for a reviewer: conversations are private
 * to their owner, and the reviewer may not be able to read what the question was about. The case carries the
 * question's digest and a placeholder to fill in from a reproduction.
 */
export async function feedbackEvalCase(
  row: NonNullable<Awaited<ReturnType<typeof getFeedbackForReview>>>
): Promise<Record<string, unknown>> {
  const reason = row.reason?.split(':')[0] ?? (row.rating === 'UP' ? 'helpful' : 'unrated');
  const base = {
    id: `feedback-${row.id.slice(-8)}-${reason}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    question: `TODO: the rated question (sha256 ${row.questionHash ?? 'not recorded'})`,
    ...(row.incidentId ? { onIncident: true } : { onIncident: false }),
    ...(row.serviceId && !row.incidentId ? { onService: true } : {}),
  };
  if (row.mode === 'basic')
    return {
      ...base,
      expectIntent: row.intent ?? 'TODO_INTENT',
      mustContain: [],
      mustNotContain: [],
    };
  return {
    ...base,
    category: reason === 'wrong_action' ? 'proposal-unwanted' : 'rca',
    script: [{ say: 'TODO: the scripted model reply' }],
    expect: { mode: 'ai' },
  };
}
