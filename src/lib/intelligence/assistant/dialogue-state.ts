import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import type { SquireIntent } from '../squire/intents';

/**
 * Dialogue state for basic mode: a pending clarification ("which service?"), the choices offered, and the
 * cursor of the list being paged. It holds no message text and no facts, only what is needed to interpret
 * the next short reply. It lives on the saved conversation when history is on, and otherwise in a small
 * encrypted table for a few minutes keyed by the person and incident, so slot filling works in both modes and
 * on every replica.
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

const scopeKey = (incidentId: string | null) => incidentId ?? '';

/** When the stored row may be forgotten: the latest expiry it carries, or one TTL from now. */
function rowExpiry(state: DialogueState, now: Date): Date {
  const times = [state.pending?.expiresAt, state.page?.expiresAt]
    .map(value => (value ? Date.parse(value) : NaN))
    .filter(Number.isFinite);
  return new Date(times.length ? Math.max(...times) : now.getTime() + DIALOGUE_STATE_TTL_MS);
}

async function readStoredState(
  userId: string,
  incidentId: string | null,
  now: Date
): Promise<DialogueState | null> {
  const row = await prisma.squireDialogueState
    .findFirst({
      where: { userId, scopeKey: scopeKey(incidentId), expiresAt: { gt: now } },
      select: { stateEncrypted: true },
    })
    .catch(() => null);
  if (!row) return null;
  try {
    const parsed = dialogueStateSchema.safeParse(JSON.parse(await decrypt(row.stateEncrypted)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
  return fresh(await readStoredState(input.userId, input.incidentId, now), now);
}

export async function writeDialogueState(input: {
  userId: string;
  conversationId?: string;
  incidentId: string | null;
  state: DialogueState | null;
}): Promise<void> {
  if (!input.conversationId) {
    await writeStoredState(input.userId, input.incidentId, input.state).catch(() => undefined);
    return;
  }
  await prisma.squireConversation
    .updateMany({
      where: { id: input.conversationId, userId: input.userId },
      data: { state: input.state ?? Prisma.DbNull },
    })
    .catch(() => undefined);
}

async function writeStoredState(
  userId: string,
  incidentId: string | null,
  state: DialogueState | null,
  now: Date = new Date()
): Promise<void> {
  const key = { userId, scopeKey: scopeKey(incidentId) };
  // Sweeps this person's expired rows on every write, so the table never outgrows live dialogues.
  await prisma.squireDialogueState.deleteMany({
    where: { userId, OR: [{ expiresAt: { lte: now } }, ...(state ? [] : [key])] },
  });
  if (!state) return;
  const stateEncrypted = await encrypt(JSON.stringify(state));
  const expiresAt = rowExpiry(state, now);
  await prisma.squireDialogueState.upsert({
    where: { userId_scopeKey: key },
    create: { ...key, stateEncrypted, expiresAt },
    update: { stateEncrypted, expiresAt },
  });
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

/** Test hook: forgets every stored dialogue that has no saved conversation. */
export async function resetDialogueMemory(): Promise<void> {
  await prisma.squireDialogueState.deleteMany({});
}
