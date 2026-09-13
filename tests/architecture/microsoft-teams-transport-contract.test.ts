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
    expect(client).toContain("bot: { id: botAddressId }");
    expect(client).toContain("botAddressId");
    // Must NOT use the old direct channelId activity path
    expect(client).not.toContain('/v3/conversations/${encodeURIComponent(args.channelId)}/activities');
    expect(client).not.toContain('directEndpoint');
    // Correct parsing: id is conversationId, activityId is messageId
    expect(client).toMatch(/const conversationId\s*=\s*typeof data\?\.id/);
    expect(client).toMatch(/const providerMessageId\s*=\s*typeof data\?\.activityId/);
    expect(client).toContain("id: conversationId");
    expect(client).toContain("activityId: messageId");
    // Separate Bot vs Graph token scopes
    expect(client).toContain("https://api.botframework.com/.default");
    expect(client).toContain("https://graph.microsoft.com/.default");
    expect(client).toContain("botTokenCache");
    expect(client).toContain("graphTokenCache");
    // Wiring: resolveServiceUrlForDestination returns botRecipientId and is plumbed to send
    expect(client).toContain("botRecipientId");
    expect(client).toContain("resolveServiceUrlForDestination");
    // Update uses PUT .../{conversationId}/activities/{activityId}
    expect(client).toContain("/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(args.messageId)}");
    // Create is non-idempotent: it must bypass retryFetch and require both IDs.
    const createStart = client.indexOf('const createEndpoint');
    const updateStart = client.indexOf('async function updateBotActivity');
    const createRegion = client.slice(createStart, updateStart);
    expect(createRegion).toContain('createRes = await fetch(createEndpoint');
    expect(createRegion).not.toContain('retryFetch(');
    expect(createRegion).toContain('if (!conversationId || !providerMessageId)');
    expect(createRegion).toContain("errorCode: 'AMBIGUOUS_SIDE_EFFECT'");
  });

  it('never automatically recreates an ambiguous card and fences ledger writes by lease', () => {
    const delivery = readFileSync('src/lib/microsoft-teams/delivery.ts', 'utf8');
    expect(delivery).not.toContain('probeMicrosoftTeamsForIncidentMessage');
    expect(delivery).toContain("new Date('9999-12-31T23:59:59.999Z')");
    expect(delivery).toContain('requiresManualReconciliation: true');
    const transactionStart = delivery.indexOf('await prisma.$transaction(async tx => {', delivery.indexOf('Durable atomic ledger'));
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
    // Required must be exactly ChannelSettings.Read.Group — check the literal array, not comments
    expect(manifest).toMatch(/MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS\s*=\s*\[\s*'ChannelSettings\.Read\.Group'/);
    // Graph message permissions are not part of the Phase-1 package.
    const requiredDecl = manifest.slice(manifest.indexOf('MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS'), manifest.indexOf('MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS'));
    expect(requiredDecl).not.toContain('ChannelMessage.Send.Group');
    expect(manifest).not.toContain("'ChannelMessage.Send.Group'");
    expect(manifest).not.toContain("'ChannelMessage.Read.Group'");
    // Capabilities must gate on botInstalled, not on ChannelMessage.Send.Group (comment mention is allowed)
    const caps = readFileSync('src/lib/microsoft-teams/capabilities.ts', 'utf8');
    expect(caps).toContain("canPost = Boolean(botInstalled)");
    expect(caps).toContain("canUpdateCard = Boolean(botInstalled)");
    // Must not gate via rsc.missing.includes('ChannelMessage...') — Bot transport is primary
    expect(caps).not.toContain("rsc.missing.includes('ChannelMessage");
    // healthy must be defined (was missing `healthy` reference in prior diff)
    expect(caps).toMatch(/const healthy\s*=\s*canPost/);
    const client = readFileSync('src/lib/microsoft-teams/client.ts', 'utf8');
    expect(client).toContain('/channels?$top=1&$select=id');
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
    // dispatchPayload is the only place that would actually send; isCentralNotificationPayload also has a case for kind
    // so locate the dispatchPayload region (contains executeProvider / Bot transport).
    const dispatchStart = cp.indexOf('async function dispatchPayload');
    expect(dispatchStart).toBeGreaterThan(-1);
    const dispatchRegion = cp.slice(dispatchStart);
    const caseStart = dispatchRegion.indexOf("case 'MICROSOFT_TEAMS_CHANNEL':");
    expect(caseStart).toBeGreaterThan(-1);
    const caseBlock = dispatchRegion.slice(caseStart, caseStart + 2500);
    expect(caseBlock).toContain('RETIRED');
    expect(caseBlock).toContain('ExternalOperation');
    expect(caseBlock).toContain("DESTINATION_NOT_FOUND");
    expect(caseBlock).not.toContain('microsoftTeamsChatProvider');
    expect(caseBlock).not.toContain('sendIncidentCard');
    expect(caseBlock).not.toContain('updateIncidentCard');
    // Real Teams path must use ExternalOperation claim-first path, not central Notification for Teams
    const svc = readFileSync('src/lib/service-notifications.ts', 'utf8');
    expect(svc).toContain('enqueueMicrosoftTeamsDelivery');
    // The Teams branch must not call enqueueCentralNotification (Slack/webhook blocks legitimately do)
    const teamsIdx = svc.indexOf("serviceChannels.includes('MICROSOFT_TEAMS'");
    expect(teamsIdx).toBeGreaterThan(-1);
    const nextBlockIdx = svc.indexOf("if (serviceChannels.includes('WEBHOOK'", teamsIdx);
    const teamsBlock = svc.slice(teamsIdx, nextBlockIdx === -1 ? teamsIdx + 1600 : nextBlockIdx);
    expect(teamsBlock).toContain('enqueueMicrosoftTeamsDelivery');
    expect(teamsBlock).not.toContain('enqueueCentralNotification');
    // Delivery must use claim-first fencing (ExternalOperation + advisory lock + AMBIGUOUS)
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
    // Must call Bot transport directly, not enqueueCentralNotification
    expect(testRoute).toContain('sendMicrosoftTeamsIncidentCard');
    expect(testRoute).not.toContain('enqueueCentralNotification');
    // Must not construct a Notification payload with lifecyclePolicy (comment mention is ok)
    expect(testRoute).not.toContain('lifecyclePolicy:');
    expect(testRoute).not.toContain('MICROSOFT_TEAMS_CHANNEL');
    // Must surface provider error via jsonProviderError, not swallow as ok
    expect(testRoute).toContain('jsonProviderError');
    expect(testRoute).toContain('integrationProviderError');
    // Response must include providerMessageId/conversationId on success
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
