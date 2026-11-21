import 'server-only';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { sha256 } from '../ai/digest';

/**
 * Answer feedback: a thumbs up or down with an optional short reason. Only the mode, the intent and a digest
 * of the question are stored, never the text, so quality can be tracked without keeping more content than
 * the saved conversation (if any) already does.
 */

export const FEEDBACK_REASONS = [
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
    note: z.string().trim().max(500).optional(),
    question: z.string().max(2_000).optional(),
    conversationId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

export async function recordFeedback(userId: string, input: FeedbackInput): Promise<string> {
  const row = await prisma.squireFeedback.create({
    data: {
      userId,
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
