import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Phase-1 Bot-transport + single-outbox contract.
 * Guards the reviewer blockers:
 *  (2) /v3/conversations must include ConversationParameters.bot + parse id/activityId correctly
 *  (3) RSC required set + Bot-primary capabilities
 *  (5) single ExternalOperation outbox (control-plane MICROSOFT_TEAMS_CHANNEL is retired)
 *  (6) Send Test must bypass lifecycle fencing and report sent/failed accurately
 */
describe('microsoft teams transport contract', () => {
  it('Bot create uses ConversationParameters.bot + parses id→conversationId, activityId→messageId', () => {
    const client = readFileSync('src/lib/microsoft-teams/client.ts', 'utf8');
    expect(client).toContain('bot: { id: botAddressId }');
    expect(client).toContain('botAddressId');
    expect(client).not.toContain(
      '/v3/conversations/${encodeURIComponent(args.channelId)}/activities'
    );
    expect(client).not.toContain('directEndpoint');
    expect(client).toMatch(/const conversationId\s*=\s*typeof data\?\.id/);
    expect(client).toMatch(/const providerMessageId\s*=\s*typeof data\?\.activityId/);
    expect(client).toContain('id: conversationId');
    expect(client).toContain('activityId: messageId');
    expect(client).toContain('https://api.botframework.com/.default');
    expect(client).toContain('https://graph.microsoft.com/.default');
    expect(client).toContain('botTokenCache');
    expect(client).toContain('graphTokenCache');
    expect(client).toContain('botRecipientId');
    expect(client).toContain('resolveServiceUrlForDestination');
    expect(client).toContain(
      '/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(args.messageId)}'
    );
    const createStart = client.indexOf('const createEndpoint');
    const updateStart = client.indexOf('async function updateBotActivity');
    const createRegion = client.slice(createStart, updateStart);
    expect(createRegion).toContain('createRes = await fetch(createEndpoint');
    expect(createRegion).not.toContain('retryFetch(');
    expect(createRegion).toContain('if (!conversationId || !providerMessageId)');
    expect(createRegion).toContain("errorCode: 'AMBIGUOUS_SIDE_EFFECT'");
    expect(client.match(/signal: AbortSignal\.timeout\(30_000\)/g)?.length).toBeGreaterThanOrEqual(
      2
    );
  });

  it('never automatically recreates an ambiguous card and fences ledger writes by lease', () => {
    const delivery = readFileSync('src/lib/microsoft-teams/delivery.ts', 'utf8');
    expect(delivery).not.toContain('probeMicrosoftTeamsForIncidentMessage');
    expect(delivery).toContain("new Date('9999-12-31T23:59:59.999Z')");
    expect(delivery).toContain('requiresManualReconciliation: true');
    expect(delivery).toContain('createAttempted: false');
    expect(delivery).toContain('statusCode >= 500');
    expect(delivery).toContain('lastKnownRejection: result.errorCode');
    const transactionStart = delivery.indexOf(
      'await prisma.$transaction(async tx => {',
      delivery.indexOf('Durable atomic ledger')
    );
    const completionCheck = delivery.indexOf('if (completed.count !== 1)', transactionStart);
    const ledgerUpsert = delivery.indexOf('microsoftTeamsIncidentMessage.upsert', transactionStart);
    expect(completionCheck).toBeGreaterThan(transactionStart);
    expect(ledgerUpsert).toBeGreaterThan(completionCheck);
  });

  it('keeps the provider transport-only with delivery as the sole ledger owner', () => {
    const provider = readFileSync('src/lib/microsoft-teams/provider.ts', 'utf8');
    expect(provider).not.toContain('microsoftTeamsIncidentMessage');
    expect(provider).not.toContain('.upsert(');
  });

  it('RSC required set is Bot-primary minimal (ChannelSettings.Read.Group only)', () => {
    const manifest = readFileSync('src/lib/microsoft-teams/app-manifest.ts', 'utf8');
    expect(manifest).toMatch(
      /MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS\s*=\s*\[\s*'ChannelSettings\.Read\.Group'/
    );
    const requiredDecl = manifest.slice(
      manifest.indexOf('MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS'),
      manifest.indexOf('MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS')
    );
    expect(requiredDecl).not.toContain('ChannelMessage.Send.Group');
    expect(manifest).not.toContain("'ChannelMessage.Send.Group'");
    expect(manifest).not.toContain("'ChannelMessage.Read.Group'");
    const caps = readFileSync('src/lib/microsoft-teams/capabilities.ts', 'utf8');
    expect(caps).toContain('canPost = Boolean(botInstalled)');
    expect(caps).toContain('canUpdateCard = Boolean(botInstalled)');
    expect(caps).not.toContain("rsc.missing.includes('ChannelMessage");
    expect(caps).toMatch(/const healthy\s*=\s*canPost/);
    const client = readFileSync('src/lib/microsoft-teams/client.ts', 'utf8');
    expect(client).toContain('/channels?$select=id');
    expect(client).not.toContain('/permissionGrants');
    expect(client).toContain('installations: installationStates');
  });

  it('binds inbound JWTs to the Teams channel endorsement and outbound tokens to trusted Connector hosts', () => {
    const auth = readFileSync('src/lib/microsoft-teams/auth.ts', 'utf8');
    const route = readFileSync('src/app/api/microsoft-teams/messages/route.ts', 'utf8');
    const client = readFileSync('src/lib/microsoft-teams/client.ts', 'utf8');
    expect(auth).toContain('isBotSigningKeyEndorsed');
    expect(auth).toContain('expectedChannelId');
    expect(route).toContain('expectedChannelId: activity.channelId');
    expect(client).toContain('normalizeTrustedMicrosoftTeamsServiceUrl');
  });

  it('retires central Notification MICROSOFT_TEAMS_CHANNEL dispatch — single outbox is ExternalOperation', () => {
    const cp = readFileSync('src/lib/notification-control-plane.ts', 'utf8');
    const dispatchStart = cp.indexOf('async function dispatchPayload');
    expect(dispatchStart).toBeGreaterThan(-1);
    const dispatchRegion = cp.slice(dispatchStart);
    const caseStart = dispatchRegion.indexOf("case 'MICROSOFT_TEAMS_CHANNEL':");
    expect(caseStart).toBeGreaterThan(-1);
    const caseBlock = dispatchRegion.slice(caseStart, caseStart + 2500);

    // Assert the executable retirement contract, not capitalization in a comment.
    expect(caseBlock).toContain('statusCode: 410');
    expect(caseBlock).toContain("errorCode: 'DESTINATION_NOT_FOUND'");
    expect(caseBlock).toContain('ExternalOperation');
    expect(caseBlock).not.toContain('microsoftTeamsChatProvider');
    expect(caseBlock).not.toContain('sendIncidentCard');
    expect(caseBlock).not.toContain('updateIncidentCard');

    const svc = readFileSync('src/lib/service-notifications.ts', 'utf8');
    expect(svc).toContain('enqueueMicrosoftTeamsDelivery');
    const teamsIdx = svc.indexOf("serviceChannels.includes('MICROSOFT_TEAMS'");
    expect(teamsIdx).toBeGreaterThan(-1);
    const nextBlockIdx = svc.indexOf("if (serviceChannels.includes('WEBHOOK'", teamsIdx);
    const teamsBlock = svc.slice(teamsIdx, nextBlockIdx === -1 ? teamsIdx + 1600 : nextBlockIdx);
    expect(teamsBlock).toContain('enqueueMicrosoftTeamsDelivery');
    expect(teamsBlock).not.toContain('enqueueCentralNotification');
    const delivery = readFileSync('src/lib/microsoft-teams/delivery.ts', 'utf8');
    expect(delivery).toContain('externalOperation');
    expect(delivery).toContain('provider_idempotencyKey');
    expect(delivery).toContain('acquireAdvisoryLock');
    expect(delivery).toContain('AMBIGUOUS');
    expect(delivery).toContain('__reserved__');
    expect(delivery).toContain('destinationSnapshot');
  });

  it('Send Test bypasses Notification lifecycle and reports sent vs failed accurately', () => {
    const testRoute = readFileSync('src/app/api/microsoft-teams/test/route.ts', 'utf8');
    expect(testRoute).toContain('sendMicrosoftTeamsIncidentCard');
    expect(testRoute).not.toContain('enqueueCentralNotification');
    expect(testRoute).not.toContain('lifecyclePolicy:');
    expect(testRoute).not.toContain('MICROSOFT_TEAMS_CHANNEL');
    expect(testRoute).toContain('jsonProviderError');
    expect(testRoute).toContain('integrationProviderError');
    expect(testRoute).toContain('providerMessageId');
    expect(testRoute).toContain('conversationId');
  });

  it('provider update forwards conversationId to Bot update', () => {
    const provider = readFileSync('src/lib/microsoft-teams/provider.ts', 'utf8');
    expect(provider).toContain('conversationId');
    const client = readFileSync('src/lib/microsoft-teams/client.ts', 'utf8');
    expect(client).toContain('conversationId?: string | null');
  });
});
