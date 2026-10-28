import 'server-only';
import prisma from '@/lib/prisma';
import { decrypt, encrypt } from '@/lib/encryption';
import { logger } from '@/lib/logger';
import { getAiSettings } from '../ai/settings';

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
  purgeBatch: 500,
} as const;

export interface ConversationSummary {
  id: string;
  title: string;
  incidentId: string | null;
  messageCount: number;
  updatedAt: Date;
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{ role: 'user' | 'assistant'; content: string; createdAt: Date }>;
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
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

const titleFrom = (question: string) => {
  const flat = question.replace(/\s+/g, ' ').trim();
  return flat.length > CONVERSATION_LIMITS.titleLength ? `${flat.slice(0, CONVERSATION_LIMITS.titleLength - 1)}…` : flat;
};

/**
 * Saves one question and its answer. Continues `conversationId` when the person owns it and it has
 * room; otherwise starts a new conversation. Returns the conversation the exchange was saved to.
 */
export async function recordExchange(input: {
  userId: string;
  conversationId?: string;
  incidentId?: string;
  question: string;
  answer: string;
}): Promise<string> {
  const [question, answer] = await Promise.all([
    encrypt(input.question),
    encrypt(input.answer.slice(0, CONVERSATION_LIMITS.storedAnswerLength)),
  ]);
  return prisma.$transaction(async tx => {
    let conversationId: string | null = null;
    if (input.conversationId) {
      // Owner-scoped and capacity-checked in one statement, so a race can never overfill a conversation.
      const claimed = await tx.squireConversation.updateMany({
        where: {
          id: input.conversationId,
          userId: input.userId,
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
          titleEncrypted: await encrypt(titleFrom(input.question)),
          incidentId: input.incidentId ?? null,
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
      if (stale.length > 0) await tx.squireConversation.deleteMany({ where: { id: { in: stale.map(row => row.id) } } });
    }
    const now = Date.now();
    await tx.squireMessage.createMany({
      data: [
        { conversationId, role: 'user', contentEncrypted: question, createdAt: new Date(now) },
        { conversationId, role: 'assistant', contentEncrypted: answer, createdAt: new Date(now + 1) },
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
    select: { id: true, titleEncrypted: true, incidentId: true, messageCount: true, updatedAt: true },
  });
  return Promise.all(
    rows.map(async row => ({
      id: row.id,
      title: (await readable(row.titleEncrypted)) || 'Conversation',
      incidentId: row.incidentId,
      messageCount: row.messageCount,
      updatedAt: row.updatedAt,
    }))
  );
}

export async function getConversation(userId: string, id: string): Promise<ConversationDetail | null> {
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
        select: { role: true, contentEncrypted: true, createdAt: true },
      },
    },
  });
  if (!row) return null;
  const messages = await Promise.all(
    row.messages.map(async message => ({
      role: message.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: await readable(message.contentEncrypted),
      createdAt: message.createdAt,
    }))
  );
  return {
    id: row.id,
    title: (await readable(row.titleEncrypted)) || 'Conversation',
    incidentId: row.incidentId,
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
 * Retention sweep, bounded per call. With history off every saved conversation is removed; otherwise
 * conversations idle longer than the configured retention are. Returns true when more may remain.
 */
export async function purgeConversations(now: Date = new Date()): Promise<{ deleted: number; more: boolean }> {
  const status = await getHistoryStatus();
  const where = status.enabled ? { updatedAt: { lt: new Date(now.getTime() - status.retentionDays * 86_400_000) } } : {};
  const batch = await prisma.squireConversation.findMany({
    where,
    orderBy: { updatedAt: 'asc' },
    take: CONVERSATION_LIMITS.purgeBatch,
    select: { id: true },
  });
  if (batch.length === 0) return { deleted: 0, more: false };
  const { count } = await prisma.squireConversation.deleteMany({ where: { id: { in: batch.map(row => row.id) } } });
  return { deleted: count, more: batch.length === CONVERSATION_LIMITS.purgeBatch };
}
