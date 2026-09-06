/**
 * Slack OAuth Callback
 * Handles the OAuth callback from Slack and stores the integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin, assertCanModifyService } from '@/lib/rbac';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { encrypt, decrypt } from '@/lib/encryption';
import { getAppUrl } from '@/lib/app-url';

const getFullUrl = (path: string, baseUrl: string) => {
  return `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
};

const isLocalhostUrl = (value: string) =>
  value.includes('localhost') || value.includes('127.0.0.1');

const getRequestOrigin = (request: NextRequest): string | null => {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (forwardedHost) {
    const protocol = forwardedProto?.split(',')[0]?.trim() || 'https';
    return `${protocol}://${forwardedHost}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
};

export async function GET(request: NextRequest) {
  // Default to sync/env URL initially
  let appUrl = 'http://localhost:3000';
  if (process.env.NEXT_PUBLIC_APP_URL) appUrl = process.env.NEXT_PUBLIC_APP_URL;
  else if (process.env.NEXTAUTH_URL) appUrl = process.env.NEXTAUTH_URL;

  try {
    // Try to get configured URL from DB
    const configuredAppUrl = await getAppUrl();
    const requestOrigin = getRequestOrigin(request);

    // Use request origin if configured URL is localhost but request comes from elsewhere
    appUrl =
      requestOrigin && isLocalhostUrl(configuredAppUrl) && !isLocalhostUrl(requestOrigin)
        ? requestOrigin
        : configuredAppUrl;

    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');

    // Get service ID if provided
    const serviceId = request.cookies.get('slack_oauth_service_id')?.value || null;
    const errorTarget = serviceId
      ? `/services/${serviceId}/settings`
      : '/settings/integrations/slack';

    // Check for OAuth errors
    if (error) {
      logger.error('[Slack] OAuth error', { error });
      return NextResponse.redirect(
        getFullUrl(
          `${errorTarget}?error=slack_oauth_error&message=${encodeURIComponent(error)}`,
          appUrl
        )
      );
    }

    if (!code || !state) {
      return NextResponse.redirect(
        getFullUrl(`${errorTarget}?error=slack_oauth_missing_params`, appUrl)
      );
    }

    // Verify state
    const storedState = request.cookies.get('slack_oauth_state')?.value;
    if (!storedState || storedState !== state) {
      logger.warn('[Slack] Invalid OAuth state', { state, storedState });
      return NextResponse.redirect(
        getFullUrl(`${errorTarget}?error=slack_oauth_invalid_state`, appUrl)
      );
    }

    const user = serviceId ? await assertCanModifyService(serviceId) : await assertAdmin();

    // Get OAuth config from database (fallback to env for backward compatibility)
    const config = await prisma.slackOAuthConfig.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    const SLACK_CLIENT_ID = config?.clientId || process.env.SLACK_CLIENT_ID;
    const SLACK_CLIENT_SECRET = config
      ? await decrypt(config.clientSecret)
      : process.env.SLACK_CLIENT_SECRET;
    const redirectUri =
      config?.redirectUri || process.env.SLACK_REDIRECT_URI || `${appUrl}/api/slack/oauth/callback`;

    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET) {
      return NextResponse.redirect(
        getFullUrl(
          `${errorTarget}?error=slack_oauth_not_configured&message=${encodeURIComponent('Slack OAuth not configured. Please configure in Settings > Slack OAuth Configuration.')}`,
          appUrl
        )
      );
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
      cache: 'no-store', // Critical: Disable caching for token exchange to prevent "invalid_code" errors
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.ok) {
      logger.error('[Slack] Token exchange failed', { error: tokenData.error });
      return NextResponse.redirect(
        getFullUrl(
          `${errorTarget}?error=slack_oauth_token_error&message=${encodeURIComponent(tokenData.error || 'Unknown error')}`,
          appUrl
        )
      );
    }

    // Get workspace info
    const teamInfo = tokenData.team;
    const botToken = tokenData.access_token;
    const scopes = (tokenData.scope || '').split(',');

    // Encrypt tokens before storing
    const encryptedBotToken = await encrypt(botToken);
    // Slack does not return a signing secret from OAuth. This previously stored
    // tokenData.authed_user.id — the installing user's Slack ID — under a field
    // named signingSecret, which could never verify a request signature. The
    // real secret is admin-entered on SlackOAuthConfig.
    const encryptedSigningSecret = null;

    // Store or update integration
    const integrationData = {
      workspaceId: teamInfo.id,
      workspaceName: teamInfo.name,
      botToken: encryptedBotToken,
      signingSecret: encryptedSigningSecret,
      installedBy: user.id,
      scopes,
      enabled: true,
    };

    let integration;
    if (serviceId) {
      // Service-specific integration
      // Check if service already has an integration
      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        include: { slackIntegration: true },
      });

      if (service?.slackIntegration) {
        if (service.slackIntegration.workspaceId === teamInfo.id) {
          // Same workspace: refresh the installation credentials in place.
          integration = await prisma.slackIntegration.update({
            where: { id: service.slackIntegration.id },
            data: integrationData,
          });
        } else {
          // A service reconnecting to a different workspace must change only
          // its binding. Never overwrite a shared installation that other
          // services still use.
          const targetWorkspace = await prisma.slackIntegration.findUnique({
            where: { workspaceId: teamInfo.id },
          });
          integration = targetWorkspace
            ? await prisma.slackIntegration.update({
                where: { id: targetWorkspace.id },
                data: integrationData,
              })
            : await prisma.slackIntegration.create({ data: integrationData });
          await prisma.service.update({
            where: { id: serviceId },
            data: { slackIntegrationId: integration.id },
          });
        }
      } else {
        // Check if workspace integration already exists
        const existing = await prisma.slackIntegration.findUnique({
          where: { workspaceId: teamInfo.id },
        });

        if (existing) {
          // Use existing integration
          integration = existing;
          // Update service to reference it
          await prisma.service.update({
            where: { id: serviceId },
            data: { slackIntegrationId: integration.id },
          });
        } else {
          // Create new integration
          integration = await prisma.slackIntegration.create({
            data: integrationData,
          });
          // Update service to reference it
          await prisma.service.update({
            where: { id: serviceId },
            data: { slackIntegrationId: integration.id },
          });
        }
      }
    } else {
      // Global integration (first workspace becomes default)
      const existing = await prisma.slackIntegration.findUnique({
        where: { workspaceId: teamInfo.id },
      });

      if (existing) {
        integration = await prisma.slackIntegration.update({
          where: { id: existing.id },
          data: integrationData,
        });
      } else {
        integration = await prisma.slackIntegration.create({
          data: integrationData,
        });
      }
    }

    // Clear cookies
    const response = NextResponse.redirect(
      getFullUrl(
        serviceId
          ? `/services/${serviceId}/settings?slack_connected=true`
          : '/settings/integrations/slack?slack_connected=true',
        appUrl
      )
    );
    response.cookies.delete('slack_oauth_state');
    response.cookies.delete('slack_oauth_service_id');

    logger.info('[Slack] Integration installed', {
      integrationId: integration.id,
      workspaceId: teamInfo.id,
      serviceId,
    });

    return response;
  } catch (error: any) {
    logger.error('[Slack] OAuth callback error', {
      error: error.message,
      stack: error.stack,
    });
    const serviceId = request.cookies.get('slack_oauth_service_id')?.value || null;
    const errorTarget = serviceId
      ? `/services/${serviceId}/settings`
      : '/settings/integrations/slack';
    return NextResponse.redirect(getFullUrl(`${errorTarget}?error=slack_oauth_error`, appUrl));
  }
}
