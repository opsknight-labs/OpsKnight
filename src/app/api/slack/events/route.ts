/**
 * Slack Event Subscriptions API
 * Listens for Slack events such as `reaction_added` (:pushpin:, :memo:)
 * and automatically captures pinned messages as OpsKnight incident notes.
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { verifySlackSignature } from '@/lib/slack-signature';

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

      // App Home tab: queued like mentions; the worker publishes the viewer's view.
      if (event.type === 'app_home_opened') {
        const { enqueueAppHome } = await import('@/lib/slack/home');
        await enqueueAppHome(payload);
        return NextResponse.json({ ok: true });
      }

      // @squire mention: queued durably and answered in the thread by the worker (Slack wants a reply
      // to the event within three seconds; an answer can take longer).
      if (event.type === 'app_mention') {
        const { enqueueSlackSquireMention } = await import('@/lib/chatops/squire/slack-events');
        await enqueueSlackSquireMention(payload);
        return NextResponse.json({ ok: true });
      }

      // War-room channel capture (off unless enabled). Slack redelivers an event it thinks was not
      // acknowledged in time, with a retry header; a redelivery is skipped so a message is saved once.
      if (event.type === 'message') {
        // "@Squire …" typed as plain text (Slack has no Squire user to mention): answered like a
        // mention. Queued by event_id, so a redelivery is a duplicate rather than a second answer.
        const { enqueueSlackSquireMention } = await import('@/lib/chatops/squire/slack-events');
        await enqueueSlackSquireMention(payload);
        if (!request.headers.get('x-slack-retry-num')) {
          const { captureSlackChannelMessage } = await import('@/lib/chatops/war-room-capture');
          await captureSlackChannelMessage(payload).catch(error =>
            logger.warn('[Slack Events] War-room message not captured', {
              error: error instanceof Error ? error.name : 'error',
            })
          );
        }
        return NextResponse.json({ ok: true });
      }

      // Reaction Added (📌 Emoji Reaction Sync): queued like mentions, so the Slack reads (which may
      // wait on Retry-After) never run inside Slack's three-second acknowledgement window. The intent
      // is keyed by event id, so a Slack redelivery is a duplicate rather than a second note.
      if (event.type === 'reaction_added') {
        const { enqueueSlackReactionPin } = await import('@/lib/chatops/war-room-reactions');
        await enqueueSlackReactionPin(payload);
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    logger.error('[Slack Events] Event handler error', { error: err });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
