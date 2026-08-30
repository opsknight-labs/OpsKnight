/**
 * Slack OAuth Initiation
 * Redirects user to Slack OAuth authorization page
 */

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin, assertCanModifyService } from '@/lib/rbac';
import { logger } from '@/lib/logger';
import prisma from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { getAppUrl } from '@/lib/app-url';
import crypto from 'crypto';
import { SLACK_BOT_SCOPES } from '@/lib/slack/app-manifest';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const serviceId = searchParams.get('serviceId');
    if (serviceId) {
      await assertCanModifyService(serviceId);
    } else {
      await assertAdmin();
    }

    // Get OAuth config from database (fallback to env for backward compatibility)
    const config = await prisma.slackOAuthConfig.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    const SLACK_CLIENT_ID = config?.clientId || process.env.SLACK_CLIENT_ID;

    let SLACK_CLIENT_SECRET: string | undefined;
    try {
      SLACK_CLIENT_SECRET = config
        ? await decrypt(config.clientSecret)
        : process.env.SLACK_CLIENT_SECRET;
    } catch (decryptError: any) {
      logger.error('[Slack] Failed to decrypt Slack Client Secret', {
        error: decryptError.message,
        configId: config?.id,
      });
      return NextResponse.json(
        {
          error: 'Failed to decrypt Slack configuration. Please re-configure Slack OAuth settings.',
        },
        { status: 500 }
      );
    }

    const configuredAppUrl = await getAppUrl();

    const SLACK_REDIRECT_URI =
      config?.redirectUri ||
      process.env.SLACK_REDIRECT_URI ||
      `${configuredAppUrl}/api/slack/oauth/callback`;

    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
      logger.warn('[Slack] Slack OAuth attempted but not fully configured', {
        hasClientId: !!SLACK_CLIENT_ID,
        hasClientSecret: !!SLACK_CLIENT_SECRET,
      });
      return NextResponse.json(
        {
          error:
            'Slack OAuth not configured. Please configure Slack OAuth settings in Settings > Slack OAuth Configuration.',
        },
        { status: 503 }
      );
    }

    const state = crypto.randomBytes(32).toString('hex');

    // Store state in session/cookie (in production, use Redis or encrypted cookie)
    // For now, we'll pass it in the callback URL
    const _callbackUrl = `${SLACK_REDIRECT_URI}?state=${state}${serviceId ? `&serviceId=${serviceId}` : ''}`;

    // Single source of truth, shared with the app manifest and the
    // Settings scope checklist so the three cannot drift apart.
    const scopes = SLACK_BOT_SCOPES.join(',');

    const authUrl =
      `https://slack.com/oauth/v2/authorize?` +
      `client_id=${SLACK_CLIENT_ID}&` +
      `scope=${scopes}&` +
      `redirect_uri=${encodeURIComponent(SLACK_REDIRECT_URI)}&` +
      `state=${state}`;

    // Store state temporarily (in production, use Redis or session)
    // For now, we'll validate it in the callback
    const response = NextResponse.redirect(authUrl);

    // Store state in cookie (encrypted in production)
    response.cookies.set('slack_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
    });

    if (serviceId) {
      response.cookies.set('slack_oauth_service_id', serviceId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
      });
    }

    // Store redirect URI in cookie for callback
    response.cookies.set('slack_oauth_redirect_uri', SLACK_REDIRECT_URI, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600,
    });

    logger.info('[Slack] Redirecting to Slack OAuth', { state, hasServiceId: !!serviceId });
    return response;
  } catch (error: any) {
    logger.error('[Slack] OAuth initiation unexpected error', {
      error: error.message,
      stack: error.stack,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
