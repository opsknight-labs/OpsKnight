/**
 * Slack Event Subscriptions API
 * Listens for Slack events such as `reaction_added` (:pushpin:, :memo:)
 * and automatically captures pinned messages as OpsKnight incident notes.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getSlackBotToken } from '@/lib/slack';
import { retryFetch } from '@/lib/retry';
import { verifySlackSignature } from '@/lib/slack-signature';

const PIN_EMOJIS = new Set([
  'pushpin',
  'round_pushpin',
  'memo',
  'star',
  'bookmark',
  'pin',
  'push_pin',
  'note',
]);

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-slack-signature') || '';
    const timestamp = request.headers.get('x-slack-request-timestamp') || '';

    // Verify signature
    const verification = await verifySlackSignature(rawBody, signature, timestamp);
    if (!verification.valid) {
      logger.warn('[Slack Events] Rejected unverified request', { reason: verification.reason });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);

    // 1. Handle Slack URL Verification Challenge
    if (payload.type === 'url_verification') {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // 2. Handle Event Callbacks
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;

      // Handle Workspace De-authorization: app_uninstalled
      if (event.type === 'app_uninstalled') {
        const workspaceId = payload.team_id || event.team_id;
        if (workspaceId) {
          const integration = await prisma.slackIntegration.findUnique({
            where: { workspaceId },
            select: { id: true },
          });
          if (integration) {
            await prisma.$transaction(async tx => {
              await tx.service.updateMany({
                where: { slackIntegrationId: integration.id },
                data: { slackIntegrationId: null },
              });
              await tx.slackIntegration.delete({ where: { id: integration.id } });
            });
            logger.info(
              '[Slack Events] Workspace uninstalled, removed integration and unlinked services',
              {
                workspaceId,
              }
            );
          }
        }
        return NextResponse.json({ ok: true });
      }

      // Handle Token Revocation: tokens_revoked
      if (event.type === 'tokens_revoked') {
        const workspaceId = payload.team_id || event.team_id;
        if (workspaceId) {
          const integration = await prisma.slackIntegration.findUnique({
            where: { workspaceId },
            select: { id: true },
          });
          if (integration) {
            await prisma.$transaction(async tx => {
              await tx.service.updateMany({
                where: { slackIntegrationId: integration.id },
                data: { slackIntegrationId: null },
              });
              await tx.slackIntegration.update({
                where: { id: integration.id },
                data: { enabled: false },
              });
            });
            logger.warn('[Slack Events] Bot tokens revoked for workspace, disabled integration', {
              workspaceId,
            });
          }
        }
        return NextResponse.json({ ok: true });
      }

      const rawEmoji = (event.reaction || '').split('::')[0];

      // Reaction Added (📌 Emoji Reaction Sync)
      if (event.type === 'reaction_added' && PIN_EMOJIS.has(rawEmoji)) {
        const channelId = event.item?.channel;
        const messageTs = event.item?.ts;
        const slackUserId = event.user;

        if (!channelId || !messageTs) {
          return NextResponse.json({ ok: true });
        }

        // Find incident linked to this channel
        const incident = await prisma.incident.findFirst({
          where: { slackChannelId: channelId },
          select: { id: true, title: true, serviceId: true, assigneeId: true },
        });

        if (!incident) {
          return NextResponse.json({ ok: true }); // Not a war-room channel
        }

        // Claim this message before doing any work. The unique key on
        // (channelId, messageTs) makes pinning idempotent, so re-reacting or a
        // second person reacting to the same message cannot duplicate the note.
        const alreadyPinned = await prisma.slackPinnedMessage.findUnique({
          where: { channelId_messageTs: { channelId, messageTs } },
          select: { id: true },
        });

        if (alreadyPinned) {
          logger.info('[Slack Events] Message already pinned, ignoring duplicate', {
            incidentId: incident.id,
            channelId,
            messageTs,
          });
          return NextResponse.json({ ok: true });
        }

        const botToken = await getSlackBotToken(incident.serviceId);
        if (!botToken) {
          return NextResponse.json({ ok: true });
        }

        // Fetch original message text from Slack history (or thread replies)
        let messageText = '';
        let authorName = 'Slack User';
        let reactorEmail: string | undefined;

        // Slack API error from history/replies, retained so a failed lookup is explained
        // rather than silently degrading to placeholder note text
        let lookupError: string | undefined;

        try {
          // Pass inclusive=true and limit=10 to reliably locate messageTs in Slack channel history
          const historyUrl = `https://slack.com/api/conversations.history?channel=${channelId}&latest=${messageTs}&inclusive=true&limit=10`;
          const historyRes = await retryFetch(historyUrl, {
            headers: { Authorization: `Bearer ${botToken}` },
          });
          const historyData = await historyRes.json();

          if (!historyData.ok) {
            lookupError = historyData.error || 'unknown_error';
          }

          const foundMsg = historyData.ok
            ? historyData.messages?.find(
                (m: { ts: string; text?: string }) => m.ts === messageTs
              ) || historyData.messages?.[0]
            : null;

          if (foundMsg?.text) {
            messageText = foundMsg.text;
          } else {
            // Fallback to conversations.replies for thread replies
            const repliesUrl = `https://slack.com/api/conversations.replies?channel=${channelId}&ts=${messageTs}&limit=5`;
            const repliesRes = await retryFetch(repliesUrl, {
              headers: { Authorization: `Bearer ${botToken}` },
            });
            const repliesData = await repliesRes.json();
            if (!repliesData.ok) {
              lookupError = lookupError || repliesData.error || 'unknown_error';
            }
            const foundReply = repliesData.ok
              ? repliesData.messages?.find(
                  (m: { ts: string; text?: string }) => m.ts === messageTs
                ) || repliesData.messages?.[0]
              : null;
            if (foundReply?.text) {
              messageText = foundReply.text;
            }
          }
        } catch (err) {
          lookupError = err instanceof Error ? err.message : String(err);
          logger.warn('[Slack Events] Failed to fetch message text', { error: err });
        }

        // Guaranteed fallback so note is never skipped
        if (!messageText) {
          if (lookupError) {
            logger.warn('[Slack Events] Could not read pinned message text', {
              incidentId: incident.id,
              channelId,
              messageTs,
              error: lookupError,
              hint:
                lookupError === 'missing_scope'
                  ? "Slack app is missing the 'channels:history' (or 'groups:history' for private channels) scope. Re-authorize Slack in Settings > Slack."
                  : undefined,
            });
          }

          messageText =
            (event as { text?: string }).text ||
            (lookupError === 'missing_scope'
              ? "(message text unavailable — Slack app is missing the 'channels:history' scope; re-authorize Slack in Settings > Slack)"
              : lookupError
                ? `(message text unavailable — Slack API error: ${lookupError})`
                : 'Pinned message from Slack war-room channel');
        }

        // Fetch reactor user info from Slack
        try {
          const userUrl = `https://slack.com/api/users.info?user=${slackUserId}`;
          const userRes = await retryFetch(userUrl, {
            headers: { Authorization: `Bearer ${botToken}` },
          });
          const userData = await userRes.json();
          if (userData.ok && userData.user) {
            authorName = userData.user.profile?.real_name || userData.user.name || slackUserId;
            reactorEmail = userData.user.profile?.email?.trim();
          }
        } catch (err) {
          logger.warn('[Slack Events] Failed to fetch reactor info', { error: err });
        }

        if (messageText) {
          // Resolve to OpsKnight user by email first, then name, then fallback to assignee
          let resolvedUser: { id: string } | null = null;
          if (reactorEmail) {
            resolvedUser = await prisma.user.findFirst({
              where: { email: { equals: reactorEmail, mode: 'insensitive' } },
              select: { id: true },
            });
          }
          if (!resolvedUser && authorName) {
            resolvedUser = await prisma.user.findFirst({
              where: { name: { contains: authorName, mode: 'insensitive' } },
              select: { id: true },
            });
          }
          // No arbitrary-user fallback: crediting a pin to whoever happens to be
          // first in the table is worse than not recording an owner for it.
          const noteUserId = resolvedUser?.id || incident.assigneeId;

          // The note is now the only record of a pin, so a missing author means
          // the pin captured nothing — say so rather than reporting success.
          if (!noteUserId) {
            logger.warn('[Slack Events] No OpsKnight user available to attribute pinned note to', {
              incidentId: incident.id,
              authorName,
            });
            return NextResponse.json({ ok: true });
          }

          const created = await prisma
            .$transaction(async tx => {
              const existingClaim = await tx.slackPinnedMessage.findUnique({
                where: {
                  channelId_messageTs: {
                    channelId,
                    messageTs,
                  },
                },
              });
              if (existingClaim) return false;

              await tx.slackPinnedMessage.create({
                data: { incidentId: incident.id, channelId, messageTs, pinnedBy: authorName },
              });

              await tx.incidentNote.create({
                data: {
                  incidentId: incident.id,
                  userId: noteUserId,
                  content: `📌 [Slack Pin by ${authorName}]: ${messageText}`,
                },
              });
              return true;
            })
            .catch(() => false);

          if (!created) {
            return NextResponse.json({ ok: true });
          }

          // Post confirmation thread reply in Slack
          await retryFetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${botToken}`,
            },
            body: JSON.stringify({
              channel: channelId,
              thread_ts: messageTs,
              text: `📌 *Saved to OpsKnight incident notes.*`,
            }),
          }).catch(() => {});

          logger.info('[Slack Events] Pinned message saved as incident note', {
            incidentId: incident.id,
            authorName,
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[Slack Events] Event handler error', { error: err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
