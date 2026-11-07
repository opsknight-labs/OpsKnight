import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import type { SquireIntent } from '../intents';
import { TtlCache } from './cache';

/**
 * Dialogue state for basic mode: a pending clarification ("which service?"), the choices offered, and the
 * cursor of the list being paged. It holds no message text and no facts, only what is needed to interpret
 * the next short reply. It lives on the saved conversation when history is on, and otherwise in memory for a
 * few minutes keyed by the person, so slot filling works in both modes.
 */

export const DIALOGUE_STATE_TTL_MS = 10 * 60_000;

const intentSchema = z.string().min(1).max(40);

export const dialogueStateSchema = z
  .object({
    v: z.literal(1),
    pending: z
      .object({
        kind: z.enum(['service', 'intent', 'person', 'incident']),
        intent: intentSchema.optional(),
        /** The original question the clarification completes. */
        question: z.string().max(2_000),
        choices: z
          .array(
            z.object({ label: z.string().max(200), id: z.string().max(64).optional() }).strict()
          )
          .max(10)
          .optional(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    page: z
      .object({
        intent: intentSchema,
        question: z.string().max(2_000),
        offset: z.number().int().min(0).max(10_000),
        total: z.number().int().min(0).optional(),
        expiresAt: z.string().datetime(),
      })
      .strict()
      .optional(),
    lastIntent: intentSchema.optional(),
    lastQuestion: z.string().max(2_000).optional(),
  })
  .strict();
export type DialogueState = z.infer<typeof dialogueStateSchema>;

const memory = new TtlCache<DialogueState>(DIALOGUE_STATE_TTL_MS, 2_000);

const memoryKey = (userId: string, incidentId: string | null) => `${userId}:${incidentId ?? ''}`;

function fresh(state: DialogueState | null, now: Date): DialogueState | null {
  if (!state) return null;
  const alive = (expiresAt?: string) => expiresAt && Date.parse(expiresAt) > now.getTime();
  return {
    ...state,
    pending: alive(state.pending?.expiresAt) ? state.pending : undefined,
    page: alive(state.page?.expiresAt) ? state.page : undefined,
  };
}

export async function readDialogueState(input: {
  userId: string;
  conversationId?: string;
  incidentId: string | null;
  now?: Date;
}): Promise<DialogueState | null> {
  const now = input.now ?? new Date();
  if (input.conversationId) {
    const row = await prisma.squireConversation
      .findFirst({
        where: { id: input.conversationId, userId: input.userId },
        select: { state: true },
      })
      .catch(() => null);
    const parsed = dialogueStateSchema.safeParse(row?.state);
    if (parsed.success) return fresh(parsed.data, now);
  }
  return fresh(memory.get(memoryKey(input.userId, input.incidentId)) ?? null, now);
}

export async function writeDialogueState(input: {
  userId: string;
  conversationId?: string;
  incidentId: string | null;
  state: DialogueState | null;
}): Promise<void> {
  const key = memoryKey(input.userId, input.incidentId);
  if (input.state) memory.set(key, input.state);
  else memory.delete(key);
  if (!input.conversationId) return;
  await prisma.squireConversation
    .updateMany({
      where: { id: input.conversationId, userId: input.userId },
      data: { state: input.state ?? Prisma.DbNull },
    })
    .catch(() => undefined);
}

export function expiry(now: Date = new Date()): string {
  return new Date(now.getTime() + DIALOGUE_STATE_TTL_MS).toISOString();
}

export function pendingState(
  kind: NonNullable<DialogueState['pending']>['kind'],
  question: string,
  intent: SquireIntent,
  choices?: Array<{ label: string; id?: string }>,
  now: Date = new Date()
): DialogueState {
  return {
    v: 1,
    pending: { kind, intent, question: question.slice(0, 2_000), choices, expiresAt: expiry(now) },
    lastIntent: intent,
    lastQuestion: question.slice(0, 2_000),
  };
}

export function pageState(
  intent: SquireIntent,
  question: string,
  offset: number,
  total: number | undefined,
  now: Date = new Date()
): DialogueState {
  return {
    v: 1,
    page: { intent, question: question.slice(0, 2_000), offset, total, expiresAt: expiry(now) },
    lastIntent: intent,
    lastQuestion: question.slice(0, 2_000),
  };
}

/** Test hook: forgets every in-memory dialogue. */
export function resetDialogueMemory(): void {
  memory.clear();
}
