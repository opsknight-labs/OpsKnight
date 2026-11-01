import Link from 'next/link';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpConnectGuide from '@/components/settings/mcp/McpConnectGuide';

export default function McpConnectSection({
  isAdmin,
  enabled,
  automaticReady,
  endpoint,
  sessionIdleDays,
  hrefs,
}: {
  isAdmin: boolean;
  enabled: boolean;
  automaticReady: boolean;
  endpoint: string | null;
  sessionIdleDays: number | null;
  hrefs: { connections: string; policy: string; overview: string };
}) {
  if (!endpoint || (!enabled && !isAdmin)) {
    return (
      <InlineNotice tone="info" title="Connection details are not available yet">
        <p>
          {isAdmin ? (
            <>
              Set the App URL first. See the{' '}
              <Link href={hrefs.overview} className="font-medium underline underline-offset-2">
                overview
              </Link>{' '}
              for what is missing.
            </>
          ) : (
            'Ask an OpsKnight administrator to turn on AI assistant access.'
          )}
        </p>
      </InlineNotice>
    );
  }
  return (
    <div className="space-y-4">
      {isAdmin && !enabled && (
        <InlineNotice tone="warning" title="MCP is turned off">
          <p>People can follow these steps once you turn on assistant access.</p>
        </InlineNotice>
      )}
      {isAdmin && enabled && !automaticReady && (
        <InlineNotice tone="warning" title="Automatic connections are off">
          <p>
            Assistants cannot connect by URL alone yet. Turn on Automatic connections in{' '}
            <Link href={hrefs.policy} className="font-medium underline underline-offset-2">
              Access policy
            </Link>{' '}
            and save.
          </p>
        </InlineNotice>
      )}
      <SettingsSection
        title="Connect your assistant"
        description="Add the OpsKnight URL to your assistant, sign in once and approve. No keys or secrets to copy."
      >
        <div className="py-5">
          <McpConnectGuide endpoint={endpoint} />
        </div>
        <div className="-mx-4 border-t border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground md:-mx-6 md:px-6">
          You stay signed in while you use the assistant
          {sessionIdleDays ? ` (${sessionIdleDays} days of inactivity signs you out)` : ''}. See or
          disconnect access in{' '}
          <Link
            href={hrefs.connections}
            className="font-medium text-foreground underline underline-offset-2"
          >
            {isAdmin ? 'Connections' : 'Your connections'}
          </Link>
          .
        </div>
      </SettingsSection>
    </div>
  );
}
