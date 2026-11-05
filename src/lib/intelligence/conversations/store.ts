import 'server-only';
import prisma from '@/lib/prisma';
import { sha256 } from '../ai/digest';
import { highestDataClass, type AiDataClass } from '../ai/port';
import {
  conversationScopeSchema,
  savedTurnInputSchema,
  storedTurnEnvelopeSchema,
  scopeForIncident,
  type ConversationScope,
  type SavedTurnInput,
  type StoredTurnEnvelope,
} from './contract';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getAiSettings } from '../ai/settings';
import { withDbBudget } from '../jobs/db-budget';

/**
 * Saved assistant conversations. Off unless an administrator turns history on; each conversation is
 * visible only to the person who had it (every read and write is keyed by owner, and a conversation
 * someone else owns is indistinguishable from one that does not exist); titles and messages are
 * encrypted at rest; storage per person is bounded; retention removes old conversations, turning
 * history off removes all of them, and deleting a person removes theirs.
 */

export const CONVERSATION_LIMITS = {
  perUser: 50,
  messagesPerConversation: 100,
  titleLength: 80,
  storedAnswerLength: 8_000,
  storedQuestionLength: 2_000,
  purgeBatch: 500,
} as const;

export interface ConversationSummary {
  id: string;
  title: string;
  incidentId: string | null;
  scope: ConversationScope;
  messageCount: number;
  updatedAt: Date;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    createdAt: Date;
    dataClass: AiDataClass;
    envelope?: StoredTurnEnvelope;
    replayable?: boolean;
    notice?: string;
    contextProof?: string;
  }>;
}

export interface HistoryStatus {
  enabled: boolean;
  retentionDays: number;
}

export async function getHistoryStatus(): Promise<HistoryStatus> {
  const settings = await getAiSettings();
  return {
    enabled: settings.enabled && settings.squireEnabled && settings.squireHistoryEnabled,
    retentionDays: settings.squireHistoryRetentionDays,
  };
}

async function readable(value: string): Promise<string> {
  try {
    return await decrypt(value);
  } catch (error) {
    // A row written under a retired key is skipped rather than breaking the whole list.
    logger.warn('[Squire] Could not decrypt a saved conversation entry', {
      error: error instanceof Error ? error.name : 'error',
    });
    return '';
  }
}

const titleFrom = (question: string) => {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length > CONVERSATION_LIMITS.titleLength
    ? `${flat.slice(0, CONVERSATION_LIMITS.titleLength - 1)}…`
    : flat;
};

/**
 * Saves one question and its answer. Continues `conversationId` when the person owns it and it has
 * room; otherwise starts a new conversation. Returns the conversation the exchange was saved to.
 */
export async function recordExchange(input: {
  userId: string;
  conversationId?: string;
  incidentId?: string;
  scope?: ConversationScope;
  dataClass?: AiDataClass;
  turn?: SavedTurnInput;
  question: string;
  answer: string;
}): Promise<string> {
  const scope = conversationScopeSchema.parse(input.scope ?? scopeForIncident(input.incidentId));
  const incidentId = scope.kind === 'INCIDENT' ? scope.incidentId : null;
  if (input.incidentId !== undefined && input.incidentId !== incidentId)
    throw new Error('Conversation context does not match the requested scope');
  const questionText = input.question.slice(0, CONVERSATION_LIMITS.storedQuestionLength);
  const answerText = input.answer.slice(0, CONVERSATION_LIMITS.storedAnswerLength);
  const parsedTurn = savedTurnInputSchema.parse(input.turn ?? {});
  const turn = {
    ...parsedTurn,
    verified: parsedTurn.verified && Boolean(parsedTurn.authorizationHash),
  };
  const dataClass = highestDataClass(['PERSONAL', input.dataClass, turn.dataClass]);
  const envelope = (text: string, metadata: SavedTurnInput) =>
    JSON.stringify(
      storedTurnEnvelopeSchema.parse({
        ...savedTurnInputSchema.parse(metadata),
        dataClass,
        v: 1,
        contentHash: sha256(text),
      })
    );
  const [question, answer, questionEnvelope, answerEnvelope] = await Promise.all([
    encrypt(questionText),
    encrypt(answerText),
    encrypt(envelope(questionText, { verified: true, dataClass })),
    encrypt(envelope(answerText, turn)),
  ]);
  return prisma.$transaction(async tx => {
    let conversationId: string | null = null;
    if (input.conversationId) {
      // Owner-scoped and capacity-checked in one statement, so a race can never overfill a conversation.
      const claimed = await tx.squireConversation.updateMany({
        where: {
          id: input.conversationId,
          userId: input.userId,
          incidentId,
          messageCount: { lte: CONVERSATION_LIMITS.messagesPerConversation - 2 },
        },
        data: { messageCount: { increment: 2 } },
      });
      if (claimed.count === 1) conversationId = input.conversationId;
    }
    if (!conversationId) {
      const created = await tx.squireConversation.create({
        data: {
          userId: input.userId,
          titleEncrypted: await encrypt(titleFrom(questionText)),
          incidentId,
          messageCount: 2,
        },
        select: { id: true },
      });
      conversationId = created.id;
      const stale = await tx.squireConversation.findMany({
        where: { userId: input.userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: CONVERSATION_LIMITS.perUser,
        select: { id: true },
      });
      if (stale.length > 0)
        await tx.squireConversation.deleteMany({ where: { id: { in: stale.map(row => row.id) } } });
    }
    const now = Date.now();
    await tx.squireMessage.createMany({
      data: [
        {
          conversationId,
          role: 'user',
          contentEncrypted: question,
          envelopeEncrypted: questionEnvelope,
          dataClass,
          createdAt: new Date(now),
        },
        {
          conversationId,
          role: 'assistant',
          contentEncrypted: answer,
          envelopeEncrypted: answerEnvelope,
          dataClass,
          createdAt: new Date(now + 1),
        },
      ],
    });
    return conversationId;
  });
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const rows = await prisma.squireConversation.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: CONVERSATION_LIMITS.perUser,
    select: {
      id: true,
      titleEncrypted: true,
      incidentId: true,
      messageCount: true,
      updatedAt: true,
    },
  });
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      title: (await readable(row.titleEncrypted)) || 'Conversation',
      incidentId: row.incidentId,
      scope: scopeForIncident(row.incidentId),
      messageCount: row.messageCount,
      updatedAt: row.updatedAt,
    }))
  );
}

export async function getConversation(
  userId: string,
  id: string
): Promise<ConversationDetail | null> {
  const row = await prisma.squireConversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      titleEncrypted: true,
      incidentId: true,
      messageCount: true,
      updatedAt: true,
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: CONVERSATION_LIMITS.messagesPerConversation,
        select: {
          role: true,
          contentEncrypted: true,
          envelopeEncrypted: true,
          dataClass: true,
          createdAt: true,
        },
      },
    },
  });
  if (!row) return null;
  const messages = await Promise.all(
    row.messages.map(async message => {
      const content = await readable(message.contentEncrypted);
      let envelope: StoredTurnEnvelope | undefined;
      if (message.envelopeEncrypted) {
        try {
          const parsed = storedTurnEnvelopeSchema.safeParse(
            JSON.parse(await readable(message.envelopeEncrypted))
          );
          if (parsed.success && parsed.data.contentHash === sha256(content)) envelope = parsed.data;
        } catch {
          /* Old/retired metadata remains unverified; it never gains replay authority. */
        }
      }
      return {
        role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
        content,
        createdAt: message.createdAt,
        dataClass: highestDataClass(['PERSONAL', message.dataClass, envelope?.dataClass]),
        ...(envelope ? { envelope } : {}),
      };
    })
  );
  return {
    id: row.id,
    title: (await readable(row.titleEncrypted)) || 'Conversation',
    incidentId: row.incidentId,
    scope: scopeForIncident(row.incidentId),
    messageCount: row.messageCount,
    updatedAt: row.updatedAt,
    messages: messages.filter(message => message.content.length > 0),
  };
}

export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  return (await prisma.squireConversation.deleteMany({ where: { id, userId } })).count > 0;
}

export async function deleteAllConversations(userId: string): Promise<number> {
  return (await prisma.squireConversation.deleteMany({ where: { userId } })).count;
}

/**
 * Retention sweep, bounded per call. With history explicitly off every saved conversation is removed; otherwise
 * conversations idle longer than the configured retention are. Returns true when more may remain.
 */
export async function purgeConversations(
  now: Date = new Date()
): Promise<{ deleted: number; more: boolean }> {
  return withDbBudget({ maxDbMs: 750 }, async tx => {
    // Availability switches do not withdraw history consent. Continue normal retention when AI
    // is paused; only the dedicated history flag requests removal of unexpired conversations.
    const settings = await getAiSettings(tx);
    const where = settings.squireHistoryEnabled
      ? {
          updatedAt: {
            lt: new Date(now.getTime() - settings.squireHistoryRetentionDays * 86_400_000),
          },
        }
      : {};
    const batch = await tx.squireConversation.findMany({
      where,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: CONVERSATION_LIMITS.purgeBatch,
      select: { id: true },
    });
    if (batch.length === 0) return { deleted: 0, more: false };
    const { count } = await tx.squireConversation.deleteMany({
      // Recheck the retention predicate if a conversation changed after candidate selection.
      where: { ...where, id: { in: batch.map(row => row.id) } },
    });
    return { deleted: count, more: batch.length === CONVERSATION_LIMITS.purgeBatch };
  });
}
