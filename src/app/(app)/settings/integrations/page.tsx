import { Bot, MessageSquare, Puzzle } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { SlackLogo, JiraLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { ServiceIntegrationsLink } from '@/components/settings/integrations/ServiceIntegrationsLink';
import { IntegrationProviderCard } from '@/components/settings/integrations/IntegrationProviderCard';
import {
  loadIntegrationStates,
  type IntegrationProviderId,
} from '@/components/settings/integrations/load-integration-states';

export const dynamic = 'force-dynamic';

const PROVIDERS: Array<{
  id: IntegrationProviderId;
  name: string;
  description: string;
  href: string;
  logo: React.ReactNode;
}> = [
  {
    id: 'slack',
    name: 'Slack',
    description:
      'Post incident alerts to channels and let responders acknowledge and resolve from Slack.',
    href: '/settings/integrations/slack',
    logo: <SlackLogo />,
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    description:
      'Send incident Adaptive Cards to Teams channels with acknowledge and resolve actions.',
    href: '/settings/integrations/microsoft-teams',
    logo: <MicrosoftTeamsLogo />,
  },
  {
    id: 'chatops',
    name: 'ChatOps war rooms',
    description:
      'Open a dedicated channel and conference bridge automatically for critical incidents.',
    href: '/settings/integrations/chatops',
    logo: <MessageSquare aria-hidden="true" />,
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Create and sync Jira issues for incidents, postmortems and action items.',
    href: '/settings/integrations/jira',
    logo: <JiraLogo />,
  },
  {
    id: 'mcp',
    name: 'AI assistants (MCP)',
    description:
      'Let approved AI assistants read and act on OpsKnight with user consent and scoped access.',
    href: '/settings/integrations/mcp',
    logo: <Bot aria-hidden="true" />,
  },
];

export default async function IntegrationsHubPage() {
  await requirePageAccess('/settings/integrations');
  const states = await loadIntegrationStates();
  const connected = PROVIDERS.filter(p => states[p.id].state === 'connected').length;
  const failed = PROVIDERS.filter(p => states[p.id].state === 'error').length;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Integrations"
        icon={Puzzle}
        description="Workspace connections for chat, ticketing and AI assistants. Alert sources are connected per service."
        stats={[
          {
            label: 'Connected',
            value: `${connected} of ${PROVIDERS.length}`,
            icon: <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />,
          },
          ...(failed > 0
            ? [{ label: "Couldn't check", value: failed, valueClassName: 'text-amber-300' }]
            : []),
        ]}
      />

      <ul
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Integrations"
      >
        {PROVIDERS.map(provider => (
          <li key={provider.id}>
            <IntegrationProviderCard
              href={provider.href}
              name={provider.name}
              description={provider.description}
              logo={provider.logo}
              state={states[provider.id].state}
              stateLabel={states[provider.id].label}
            />
          </li>
        ))}
      </ul>

      <ServiceIntegrationsLink
        title="Alert sources and per-service routing"
        description="Webhooks, Alertmanager, Datadog, CloudWatch and per-service Slack channels are set up on each service's Integrations tab."
      />
    </div>
  );
}
