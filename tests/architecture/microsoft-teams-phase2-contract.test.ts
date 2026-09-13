import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Microsoft Teams Phase 2 architecture', () => {
  it('keeps the route as an authenticated protocol boundary', () => {
    const route = fs.readFileSync('src/app/api/microsoft-teams/messages/route.ts', 'utf8');
    expect(route).toContain('assertMicrosoftTeamsActivityAuth');
    expect(route).toContain('handleMicrosoftTeamsAdaptiveCardAction');
    expect(route).not.toContain('prisma.incident.update');
  });

  it('keeps the invoke adapter out of canonical Teams transport writes', () => {
    const invoke = fs.readFileSync('src/lib/microsoft-teams/invoke.ts', 'utf8');
    expect(invoke).not.toContain('updateMicrosoftTeamsIncidentCard');
    expect(invoke).not.toContain('sendMicrosoftTeamsIncidentCard');
    expect(invoke).not.toContain('prisma.incident.update');
    expect(invoke).toContain('executeChatOpsCommand');
  });

  it('does not add broad Graph identity permissions', () => {
    const sources = [fs.readFileSync('src/lib/microsoft-teams/app-manifest.ts', 'utf8'), fs.readFileSync('src/lib/microsoft-teams/identity.ts', 'utf8'), fs.readFileSync('src/lib/microsoft-teams/invoke.ts', 'utf8')].join('\n');
    expect(sources).not.toMatch(/User\.Read\.All|Directory\.Read\.All|TeamMember\.Read\.All|ChannelMessage\.Read\.All/);
  });

  it('uses one central Action.Execute verb registry', () => {
    const cards = fs.readFileSync('src/lib/microsoft-teams/cards.ts', 'utf8');
    expect(cards).toContain('TEAMS_CHATOPS_VERBS');
    expect(cards).not.toContain("verb: 'opsknight.");
  });

  it('derives the customer tenant from authenticated Teams channel data, not Connector JWT claims', () => {
    const auth = fs.readFileSync('src/lib/microsoft-teams/auth.ts', 'utf8');
    const route = fs.readFileSync('src/app/api/microsoft-teams/messages/route.ts', 'utf8');
    expect(auth).not.toMatch(/claims\.(?:tid|tenantId)/);
    expect(route).toContain("activity.channelData?.tenant?.id");
    expect(route).toContain('enforceMicrosoftTeamsTenantAllowlist');
  });

  it('increments canonical generation on replacement update and never uses updatedAt as a route fence', () => {
    const delivery = fs.readFileSync('src/lib/microsoft-teams/delivery.ts', 'utf8');
    expect(delivery).toContain('messageGeneration: 1');
    expect(delivery).toMatch(/update:\s*\{[\s\S]*replacingCanonicalActivity[\s\S]*messageGeneration: \{ increment: 1 \}/);
    expect(delivery).not.toContain('Teams destination was updated after enqueue');
  });

  it('forwards transport idempotency into the manual escalation domain', () => {
    const commands = fs.readFileSync('src/lib/chatops/commands.ts', 'utf8');
    const escalation = fs.readFileSync('src/lib/escalation/authorization.ts', 'utf8');
    expect(commands).toContain('executeEscalate(provider, actor, command.incidentId, idempotency)');
    expect(escalation).toContain('MANUAL_ESCALATION_IDEMPOTENCY');
    expect(escalation).toContain('generation: cursor.generation');
    expect(escalation).toContain('stepIndex: cursor.stepIndex');
  });

  it('persists relative snooze input as an absolute intent deadline', () => {
    const invoke = fs.readFileSync('src/lib/microsoft-teams/invoke.ts', 'utf8');
    expect(invoke).toContain('const snoozedUntil = action.action.verb === TEAMS_CHATOPS_VERBS.SNOOZE');
    expect(invoke).toContain('persistedPayload.snoozedUntil');
    expect(invoke).not.toContain('snoozedUntil: new Date(Date.now() + actionData.minutes');
  });
});
