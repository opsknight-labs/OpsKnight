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
});
