'use server';

import * as z from 'zod/v3';
import prisma from '@/lib/prisma';
import { assertAdmin } from '@/lib/rbac';
import { emitAuditEvent } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { isChannelAvailable } from '@/lib/notification-providers';
import {
  pageSubscriberChannels,
  SUBSCRIBER_CHANNELS,
  type SubscriberChannel,
} from '@/lib/status-pages/subscriber-channel-policy';

const idSchema = z.string().min(1).max(64);
const saveSchema = z
  .object({
    statusPageId: idSchema,
    channels: z.array(z.enum(SUBSCRIBER_CHANNELS)).max(SUBSCRIBER_CHANNELS.length),
  })
  .strict();

export type SubscriberChannelSettings = {
  channels: SubscriberChannel[];
  /** SMS needs a configured SMS provider; the switch says so when there is none. */
  smsAvailable: boolean;
};

/** Which subscriber channels this page offers visitors. Admins only, like the rest of page settings. */
export async function loadSubscriberChannelsAction(
  statusPageId: unknown
): Promise<SubscriberChannelSettings | null> {
  const id = idSchema.safeParse(statusPageId);
  if (!id.success) return null;
  try {
    await assertAdmin();
  } catch {
    return null;
  }
  const page = await prisma.statusPage.findUnique({
    where: { id: id.data },
    select: { subscriberChannels: true },
  });
  if (!page) return null;
  return {
    channels: pageSubscriberChannels(page),
    smsAvailable: await isChannelAvailable('SMS').catch(() => false),
  };
}

/**
 * Turns subscriber channels on or off for a page. Existing subscribers on a switched-off channel
 * keep their rows but receive nothing until it is on again. Written without touching
 * `updatedAt` (the settings form's optimistic-concurrency token), audited, then republished
 * because the public page lists the channels.
 */
export async function saveSubscriberChannelsAction(
  input: unknown
): Promise<{ ok: true; channels: SubscriberChannel[] } | { ok: false; error: string }> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Choose valid subscriber channels.' };
  let actorId: string;
  try {
    actorId = (await assertAdmin()).id;
  } catch {
    return { ok: false, error: 'Admin access required.' };
  }
  const { statusPageId } = parsed.data;
  const channels = pageSubscriberChannels({ subscriberChannels: parsed.data.channels });
  const current = await prisma.statusPage.findUnique({
    where: { id: statusPageId },
    select: { subscriberChannels: true },
  });
  if (!current) return { ok: false, error: 'Status page not found.' };
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      UPDATE "StatusPage" SET "subscriberChannels" = ${channels}::text[]
      WHERE "id" = ${statusPageId}`;
    await emitAuditEvent(
      {
        action: 'status_page.subscriber_channels_updated',
        source: 'UI',
        actor: { type: 'USER', id: actorId },
        target: { type: 'STATUS_PAGE', id: statusPageId },
        oldValue: { channels: pageSubscriberChannels(current) },
        newValue: { channels },
      },
      tx
    );
  });
  try {
    const { rebuildStatusPageSnapshot } = await import('@/lib/status-pages/snapshot');
    await rebuildStatusPageSnapshot(statusPageId);
  } catch (error) {
    // The saved setting is authoritative; the next publication picks it up.
    logger.warn('status_page.subscriber_channels_republish_failed', {
      statusPageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: true, channels };
}
