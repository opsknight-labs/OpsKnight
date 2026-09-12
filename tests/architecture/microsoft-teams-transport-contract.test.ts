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
  });

  it('RSC required set is Bot-primary minimal (ChannelSettings.Read.Group only)', () => {
    const manifest = readFileSync('src/lib/microsoft-teams/app-manifest.ts', 'utf8');
    // Required must be exactly ChannelSettings.Read.Group — check the literal array, not comments
    expect(manifest).toMatch(/MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS\s*=\s*\[\s*'ChannelSettings\.Read\.Group'/);
    // Required array must not declare ChannelMessage.Send.Group (optional array does)
    const requiredDecl = manifest.slice(manifest.indexOf('MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS'), manifest.indexOf('MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS'));
    expect(requiredDecl).not.toContain('ChannelMessage.Send.Group');
    // ChannelMessage.Send.Group must be optional (legacy/Graph path)
    expect(manifest).toMatch(/MICROSOFT_TEAMS_OPTIONAL_RSC_PERMISSIONS[^]*ChannelMessage\.Send\.Group/);
    // Capabilities must gate on botInstalled, not on ChannelMessage.Send.Group (comment mention is allowed)
    const caps = readFileSync('src/lib/microsoft-teams/capabilities.ts', 'utf8');
    expect(caps).toContain("canPost = Boolean(botInstalled)");
    expect(caps).toContain("canUpdateCard = Boolean(botInstalled)");
    // Must not gate via rsc.missing.includes('ChannelMessage...') — Bot transport is primary
    expect(caps).not.toContain("rsc.missing.includes('ChannelMessage");
    // healthy must be defined (was missing `healthy` reference in prior diff)
    expect(caps).toMatch(/const healthy\s*=\s*canPost/);
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
