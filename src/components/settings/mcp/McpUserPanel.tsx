import Link from 'next/link';
import { Bot, Unplug } from 'lucide-react';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import McpConfirmAction from '@/components/settings/mcp/McpConfirmAction';
import McpGrantList from '@/components/settings/mcp/McpGrantList';
import { ListEmpty } from '@/components/settings/mcp/McpListKit';
import type { McpGrantRow } from '@/app/(app)/settings/integrations/mcp/queries';
import type { McpConnectionActivity } from '@/app/(app)/settings/integrations/mcp/activity';

/**
 * The user detail page's MCP panel, for administrators: this person's assistant connections and
 * personal tokens, each revocable, and one action that disconnects all of them.
 */
export default function McpUserPanel({
  userId,
  name,
  rows,
  total,
  active,
  now,
  timeZone,
  describeScope,
  revokeAction,
  revokeAllAction,
  activityAction,
}: {
  userId: string;
  name: string;
  rows: McpGrantRow[];
  /** All of this person's connections, which may be more than the list shows. */
  total: number;
  /** Connections not revoked yet: what "Disconnect all" revokes. */
  active: number;
  now: Date;
  timeZone: string;
  describeScope: (scope: string) => string;
  revokeAction: (form: FormData) => Promise<void>;
  revokeAllAction: (form: FormData) => Promise<void>;
  activityAction: (input: {
    grantId: string;
    cursor?: { at: string; id: string };
  }) => Promise<McpConnectionActivity>;
}) {
  return (
    <SettingsSection
      title="AI assistant access (MCP)"
      description={`Assistants ${name} connected to OpsKnight and their personal access tokens. Each works with ${name}'s own permissions.`}
      action={
        active > 0 ? (
          <McpConfirmAction
            action={revokeAllAction}
            fields={{ userId }}
            label="Disconnect all of this person's assistants"
            accessibleLabel={`Disconnect all of ${name}'s assistants`}
            icon={<Unplug className="h-3.5 w-3.5" aria-hidden="true" />}
            title={`Disconnect all of ${name}'s assistants?`}
            confirmLabel="Disconnect all"
            successMessage="Assistants disconnected"
            className="min-h-11 w-full sm:w-auto"
            acknowledgement={`I understand every assistant and personal token of ${name} stops working.`}
            description={
              <p>
                This revokes {active === 1 ? 'their 1 connection' : `all ${active} connections`},
                including personal access tokens. Each stops working on its next request. They can
                connect again any time.
              </p>
            }
          />
        ) : undefined
      }
      footer={
        total > rows.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the newest {rows.length} of {total}.{' '}
            <Link
              href="/settings/integrations/mcp?tab=connections&status=all"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Open all connections
            </Link>
          </p>
        ) : undefined
      }
    >
      <div className="-mx-4 md:-mx-6">
        {rows.length === 0 ? (
          <ListEmpty icon={<Bot className="h-5 w-5" aria-hidden="true" />} title="No connections">
            {name} has not connected an assistant or created a personal token.
          </ListEmpty>
        ) : (
          <McpGrantList
            rows={rows}
            show="assistant"
            caption={`${name}'s assistant connections`}
            now={now}
            timeZone={timeZone}
            describeScope={describeScope}
            revokeAction={revokeAction}
            activityAction={activityAction}
          />
        )}
      </div>
    </SettingsSection>
  );
}
