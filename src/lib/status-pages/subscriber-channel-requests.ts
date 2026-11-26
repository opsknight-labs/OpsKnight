import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { logger } from '@/lib/logger';
import { encrypt } from '@/lib/encryption';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/client-ip';
import { safeOutboundFetch } from '@/lib/network-security';
import { formatToE164 } from '@/lib/sms';
import { isChannelAvailable } from '@/lib/notification-providers';
import { enqueueCentralNotification } from '@/lib/notification-control-plane';
import { getBaseUrl } from '@/lib/env-validation';
import { getStatusPagePublicUrl } from '@/lib/status-page-url';
import { getOpenStatusSnapshot } from './public-access';
import { validateSubscriberWebhookUrl } from './subscriber-webhooks';
import { hashSubscriptionToken } from './subscription-tokens';
import { resolveSubscriptionSelection, syncSubscriptionSelection } from './subscriptions';
import { chatMessageBody } from './subscriber-channels';
import {
  channelSubscriberKey,
  isChatWebhookHost,
  pageSubscriberChannels,
  type ChatChannel,
  type SubscriberChannel,
} from './subscriber-channel-policy';

const MAX_CHANNEL_SUBSCRIBERS_PER_PAGE = 1_000;
const SMS_CODE_TTL_MS = 10 * 60_000;
const TEST_TIMEOUT_MS = 5_000;
/** States a new sign-up may (re)start; COMPLAINED/BOUNCED/SUPPRESSED keep their suppression. */
const RESTARTABLE_STATES = ['PENDING', 'UNSUBSCRIBED'] as const;

const preferencesSchema = z
  .object({
    selectedServiceIds: z.array(z.string().min(1).max(200)).max(100).optional(),
    selectedBusinessServiceIds: z.array(z.string().min(1).max(200)).max(50).optional(),
    timezone: z.string().max(100).optional(),
  })
  .optional();

const ChatSubscribeSchema = z
  .object({
    channel: z.enum(['SLACK', 'MICROSOFT_TEAMS']),
    url: z.string().trim().min(1).max(2048),
    preferences: preferencesSchema,
  })
  .strict();
const SmsSubscribeSchema = z
  .object({ phone: z.string().trim().min(5).max(32), preferences: preferencesSchema })
  .strict();
const SmsVerifySchema = z
  .object({
    phone: z.string().trim().min(5).max(32),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

const tooMany = () => jsonError('Too many requests. Try again shortly.', 429);

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** The page behind a public slug, only when it accepts subscribers on `channel`. */
async function subscribablePage(slug: string, channel: SubscriberChannel) {
  const snapshot = await getOpenStatusSnapshot(slug);
  if (!snapshot || !snapshot.page.showSubscribe) return null;
  const page = await prisma.statusPage.findUnique({ where: { id: snapshot.page.id } });
  return page?.enabled && pageSubscriberChannels(page).includes(channel) ? page : null;
}

async function underCap(statusPageId: string, channel: string) {
  const total = await prisma.statusPageSubscription.count({
    where: { statusPageId, channel, state: { in: ['ACTIVE', 'PENDING'] } },
  });
  return total < MAX_CHANNEL_SUBSCRIBERS_PER_PAGE;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Verification for chat webhooks: the endpoint must accept a real test message. */
export async function sendChatTestMessage(
  channel: ChatChannel,
  url: string,
  pageName: string,
  links: Array<{ label: string; url: string }>
): Promise<boolean> {
  try {
    const response = await safeOutboundFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'OpsKnight-StatusPage/1.0' },
      body: JSON.stringify(
        chatMessageBody(
          channel,
          `Subscribed to ${pageName} status updates`,
          'This channel will get incident and maintenance updates from this status page.',
          links
        )
      ),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/status/[slug]/subscribe/chat  { channel: SLACK | MICROSOFT_TEAMS, url, preferences? }
 * Subscribes a Slack or Teams incoming webhook. It is active once the webhook accepted a test
 * message (which carries the unsubscribe link); the URL is stored encrypted.
 */
export async function subscribeChatRequest(req: NextRequest, slug: string) {
  try {
    const ip = getClientIp(req.headers);
    if (!(await checkRateLimit(`api:status:subscribe-chat:ip:${ip}`, 5, 60_000)).allowed)
      return tooMany();
    const parsed = ChatSubscribeSchema.safeParse(await readJson(req));
    if (!parsed.success) return jsonError('A channel and webhook URL are required.', 400);
    const { channel, preferences } = parsed.data;
    const page = await subscribablePage(slug, channel);
    if (!page) return jsonError('Not found', 404);

    const checked = await validateSubscriberWebhookUrl(parsed.data.url);
    if (!checked.ok) return jsonError(checked.reason, 400);
    if (!isChatWebhookHost(channel, checked.url))
      return jsonError(
        channel === 'SLACK'
          ? 'Enter a Slack incoming-webhook URL (https://hooks.slack.com/…).'
          : 'Enter a Microsoft Teams incoming-webhook or Workflows URL.',
        400
      );
    const url = checked.url.toString();
    const key = channelSubscriberKey(channel, url);
    if (
      !(await checkRateLimit(`api:status:subscribe-chat:target:${page.id}:${key}`, 3, 10 * 60_000))
        .allowed
    )
      return tooMany();

    const selection = await resolveSubscriptionSelection(page, preferences);
    if ('error' in selection) return selection.error;
    const existing = await prisma.statusPageSubscription.findUnique({
      where: { statusPageId_email: { statusPageId: page.id, email: key } },
      select: { id: true, state: true },
    });
    // Same answer for active and suppressed rows, so the form cannot probe a stranger's webhook.
    if (existing && !(RESTARTABLE_STATES as readonly string[]).includes(existing.state))
      return jsonOk({ subscribed: true, alreadySubscribed: true }, 200);
    if (!existing && !(await underCap(page.id, channel)))
      return jsonError('This page cannot accept more subscribers on this channel.', 429);

    const token = randomBytes(32).toString('hex');
    const statusPageUrl = getStatusPagePublicUrl(page, getBaseUrl());
    const unsubscribeUrl = `${statusPageUrl}/unsubscribe/${token}`;
    const accepted = await sendChatTestMessage(channel, url, page.organizationName || page.name, [
      { label: 'View status page', url: statusPageUrl },
      { label: 'Unsubscribe', url: unsubscribeUrl },
    ]);
    if (!accepted)
      return jsonError(
        'The webhook did not accept a test message. Check the URL and try again.',
        400
      );

    const data = {
      channel,
      targetEncrypted: await encrypt(url),
      token: hashSubscriptionToken(token),
      state: 'ACTIVE' as const,
      verified: true,
      unsubscribedAt: null,
      suppressionReason: null,
      verificationToken: null,
      verificationTokenExpiresAt: null,
      ...(selection.provided ? { preferences: selection.preferences ?? Prisma.DbNull } : {}),
    };
    let subscriptionId: string;
    try {
      subscriptionId = existing
        ? (await prisma.statusPageSubscription.update({ where: { id: existing.id }, data })).id
        : (
            await prisma.statusPageSubscription.create({
              data: { statusPageId: page.id, email: key, ...data },
              select: { id: true },
            })
          ).id;
    } catch (error) {
      if (isUniqueViolation(error))
        return jsonOk({ subscribed: true, alreadySubscribed: true }, 200);
      throw error;
    }
    await syncSubscriptionSelection(subscriptionId, selection);
    logger.info('api.status.subscribe_chat.activated', {
      pageId: page.id,
      channel,
      subscriptionId,
    });
    return jsonOk({ subscribed: true, unsubscribeUrl }, 201);
  } catch (error) {
    logger.error('api.status.subscribe_chat.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to subscribe', 500);
  }
}

function smsCodeHash(statusPageId: string, phone: string, code: string) {
  return hashSubscriptionToken(`sms:${statusPageId}:${phone}:${code}`);
}

const smsAccepted = () =>
  jsonOk(
    { pending: true, message: 'If this number can receive updates, we sent a 6-digit code.' },
    200
  );

/**
 * POST /api/status/[slug]/subscribe/sms  { phone, preferences? }
 * Starts an SMS subscription: a PENDING row and a 6-digit code (valid 10 minutes) sent through
 * the configured SMS provider. Answers the same for every number so it cannot be probed.
 */
export async function subscribeSmsRequest(req: NextRequest, slug: string) {
  try {
    const ip = getClientIp(req.headers);
    if (!(await checkRateLimit(`api:status:subscribe-sms:ip:${ip}`, 5, 60_000)).allowed)
      return tooMany();
    const parsed = SmsSubscribeSchema.safeParse(await readJson(req));
    if (!parsed.success) return jsonError('A phone number is required.', 400);
    const phone = formatToE164(parsed.data.phone);
    if (!phone)
      return jsonError('Enter the number with its country code, for example +14155550100.', 400);
    const page = await subscribablePage(slug, 'SMS');
    if (!page) return jsonError('Not found', 404);
    if (!(await isChannelAvailable('SMS')))
      return jsonError('Text message updates are not available right now.', 503);
    if (
      !(await checkRateLimit(`api:status:subscribe-sms:phone:${page.id}:${phone}`, 3, 10 * 60_000))
        .allowed
    )
      return tooMany();

    const selection = await resolveSubscriptionSelection(page, parsed.data.preferences);
    if ('error' in selection) return selection.error;
    const key = channelSubscriberKey('SMS', phone);
    const existing = await prisma.statusPageSubscription.findUnique({
      where: { statusPageId_email: { statusPageId: page.id, email: key } },
      select: { id: true, state: true },
    });
    if (existing && !(RESTARTABLE_STATES as readonly string[]).includes(existing.state))
      return smsAccepted();
    if (!existing && !(await underCap(page.id, 'SMS')))
      return jsonError('This page cannot accept more subscribers on this channel.', 429);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const verificationToken = smsCodeHash(page.id, phone, code);
    const data = {
      channel: 'SMS',
      phone,
      token: hashSubscriptionToken(randomBytes(32).toString('hex')),
      state: 'PENDING' as const,
      verified: false,
      unsubscribedAt: null,
      verificationToken,
      verificationTokenExpiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
      ...(selection.provided ? { preferences: selection.preferences ?? Prisma.DbNull } : {}),
    };
    let subscriptionId: string;
    try {
      if (existing) {
        // Compare-and-set: a provider suppression that landed meanwhile wins.
        const restarted = await prisma.statusPageSubscription.updateMany({
          where: { id: existing.id, state: { in: [...RESTARTABLE_STATES] } },
          data,
        });
        if (!restarted.count) return smsAccepted();
        subscriptionId = existing.id;
      } else {
        subscriptionId = (
          await prisma.statusPageSubscription.create({
            data: { statusPageId: page.id, email: key, ...data },
            select: { id: true },
          })
        ).id;
      }
    } catch (error) {
      if (isUniqueViolation(error)) return smsAccepted();
      throw error;
    }
    await syncSubscriptionSelection(subscriptionId, selection);
    await enqueueCentralNotification({
      category: 'STATUS_PAGE',
      channel: 'SMS',
      recipientType: 'SUBSCRIBER',
      recipientId: subscriptionId,
      recipientAddress: phone,
      templateKey: 'status-page-sms-verification',
      sourceType: 'STATUS_PAGE_SUBSCRIPTION',
      sourceId: subscriptionId,
      eventKey: verificationToken,
      displayMessage: `Verify SMS updates for ${page.name}`,
      priority: 2,
      trafficClass: 'TRANSACTIONAL',
      payload: {
        kind: 'SMS',
        to: phone,
        message: `${page.organizationName || page.name}: your status update code is ${code}. It expires in 10 minutes.`,
      },
    });
    logger.info('api.status.subscribe_sms.code_sent', { pageId: page.id, subscriptionId });
    return smsAccepted();
  } catch (error) {
    logger.error('api.status.subscribe_sms.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to subscribe', 500);
  }
}

/** POST /api/status/[slug]/subscribe/sms/verify  { phone, code }. Five tries per number per 10 minutes. */
export async function verifySmsRequest(req: NextRequest, slug: string) {
  try {
    const ip = getClientIp(req.headers);
    if (!(await checkRateLimit(`api:status:verify-sms:ip:${ip}`, 10, 60_000)).allowed)
      return tooMany();
    const parsed = SmsVerifySchema.safeParse(await readJson(req));
    if (!parsed.success) return jsonError('Enter the 6-digit code.', 400);
    const phone = formatToE164(parsed.data.phone);
    const page = phone ? await subscribablePage(slug, 'SMS') : null;
    if (!phone || !page) return jsonError('That code is invalid or has expired.', 400);
    if (
      !(await checkRateLimit(`api:status:verify-sms:phone:${page.id}:${phone}`, 5, 10 * 60_000))
        .allowed
    )
      return tooMany();
    const sub = await prisma.statusPageSubscription.findUnique({
      where: {
        statusPageId_email: { statusPageId: page.id, email: channelSubscriberKey('SMS', phone) },
      },
      select: { id: true, state: true, verificationToken: true, verificationTokenExpiresAt: true },
    });
    const expected = Buffer.from(smsCodeHash(page.id, phone, parsed.data.code));
    const stored = Buffer.from(sub?.verificationToken ?? '');
    const valid =
      sub?.state === 'PENDING' &&
      Boolean(sub.verificationTokenExpiresAt && sub.verificationTokenExpiresAt > new Date()) &&
      stored.length === expected.length &&
      timingSafeEqual(stored, expected);
    if (!sub || !valid) return jsonError('That code is invalid or has expired.', 400);
    const activated = await prisma.statusPageSubscription.updateMany({
      where: { id: sub.id, state: 'PENDING', verificationToken: sub.verificationToken },
      data: {
        state: 'ACTIVE',
        verified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      },
    });
    if (!activated.count) return jsonError('That code is invalid or has expired.', 400);
    logger.info('api.status.subscribe_sms.verified', { pageId: page.id, subscriptionId: sub.id });
    return jsonOk({ subscribed: true }, 200);
  } catch (error) {
    logger.error('api.status.verify_sms.error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError('Failed to verify', 500);
  }
}
