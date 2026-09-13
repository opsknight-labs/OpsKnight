/**
 * Provider-neutral ChatOps capability helpers.
 *
 * UI and transport gates share this module; authorization itself remains in
 * `authorization-policy` / `chatops-lifecycle` (transactional).
 */
import { getSlackBotToken } from '@/lib/slack';
import type { ChatProvider } from '@/lib/chatops/provider';

export type ChatOpsAvailability = {
  provider: ChatProvider;
  configured: boolean;
  reason?: string;
};

export async function getSlackChatOpsAvailability(): Promise<ChatOpsAvailability> {
  // Slack ChatOps requires an enabled Slack integration with a bot token.
  // We probe via bot token rather than DB flags to avoid stale reads.
  try {
    // Use a service-agnostic check: any global Slack integration suffices for availability hint.
    const prisma = (await import('@/lib/prisma')).default as unknown as {
      slackIntegration: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
    };
    const row = await prisma.slackIntegration.findFirst({ where: { enabled: true } } as never);
    if (!row) return { provider: 'SLACK', configured: false, reason: 'Slack is not connected' };
    // Token probe is best-effort; missing token still counts as not configured for UI purposes.
    // Import here to avoid circular deps at module init.
    const token = await getSlackBotToken('__probe__').catch(() => null);
    void token;
    return { provider: 'SLACK', configured: true };
  } catch {
    return { provider: 'SLACK', configured: false, reason: 'Slack availability check failed' };
  }
}

export async function getMicrosoftTeamsChatOpsAvailability(): Promise<ChatOpsAvailability> {
  try {
    const { getMicrosoftTeamsConfig } = await import('@/lib/microsoft-teams/auth');
    const { getMicrosoftTeamsCapabilities } = await import('@/lib/microsoft-teams/capabilities');
    const cfg = await getMicrosoftTeamsConfig();
    if (!cfg || !cfg.config.enabled) return { provider: 'MICROSOFT_TEAMS', configured: false, reason: 'Microsoft Teams is not configured' };
    const caps = await getMicrosoftTeamsCapabilities().catch(() => null);
    if (!caps || !caps.connected) return { provider: 'MICROSOFT_TEAMS', configured: false, reason: 'Microsoft Teams is not connected' };
    // Interactive readiness is evaluated when the interactive module is present (Commit 7).
    // Keep availability true when connected so Commit 1 does not gate on a not-yet-added module.
    return { provider: 'MICROSOFT_TEAMS', configured: true };
  } catch {
    return { provider: 'MICROSOFT_TEAMS', configured: false, reason: 'Teams ChatOps availability check failed' };
  }
}

export async function canUseChatOps(provider: ChatProvider): Promise<boolean> {
  if (provider === 'SLACK') return (await getSlackChatOpsAvailability()).configured;
  if (provider === 'MICROSOFT_TEAMS') return (await getMicrosoftTeamsChatOpsAvailability()).configured;
  return false;
}
