import { IntelligenceGroupHeader } from '@/components/settings/layout/IntelligenceGroupHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import EmptyState from '@/components/patterns/EmptyState';
import RelativeTime from '@/components/patterns/RelativeTime';
import { Badge } from '@/components/ui/shadcn/badge';
import prisma from '@/lib/prisma';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES, hasCapability, type AppRole } from '@/lib/authorization';
import { requirePageAccess } from '@/lib/access/server';
import { getSquireMemorySettings } from '@/lib/intelligence/memory/settings';
import { AddDocSourceForm, DocSourceButtons } from './DocSourceForms';

export const dynamic = 'force-dynamic';

const STATUS_VARIANT = {
  OK: 'success',
  FAILED: 'danger',
  SYNCING: 'info',
} as const;

/** The organisation's own documentation that Squire searches. Visible to intelligence readers, changed by managers. */
export default async function DocSourcesPage() {
  await requirePageAccess('/settings/intelligence/ai');
  const user = await assertCapability(CAPABILITIES.INTELLIGENCE_READ);
  const canManage = hasCapability(user.role as AppRole, CAPABILITIES.INTELLIGENCE_MANAGE);
  const [sources, teams, memory] = await Promise.all([
    prisma.knowledgeDocSource.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        kind: true,
        url: true,
        ref: true,
        path: true,
        teamId: true,
        lastStatus: true,
        lastError: true,
        lastSyncedAt: true,
        documentCount: true,
      },
    }),
    prisma.team.findMany({ orderBy: { name: 'asc' }, take: 200, select: { id: true, name: true } }),
    getSquireMemorySettings(),
  ]);
  const teamNames = new Map(teams.map(team => [team.id, team.name]));

  return (
    <div className="space-y-6">
      <IntelligenceGroupHeader group="assistant" title="Documentation sources" visible={[]}>
        Your own runbooks and guides, from a Git repository or an archive, searchable by Squire.
      </IntelligenceGroupHeader>
      <SettingsSection
        title="Sources"
        description={
          memory.knowledgeEnabled
            ? 'Synced every six hours. Only .md, .mdx and .txt files are read: up to 2,000 files of 1 MB each, from an archive of at most 20 MB.'
            : 'Knowledge memory is off, so sources are not synced or searched until it is turned on under Assistant.'
        }
      >
        {sources.length === 0 ? (
          <EmptyState
            size="sm"
            variant="simple"
            title="No documentation sources"
            description={canManage ? 'Add one below.' : 'An administrator can add one.'}
          />
        ) : (
          <ul className="my-3 divide-y divide-border rounded-lg border border-border">
            {sources.map(source => (
              <li key={source.id} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{source.name}</span>
                  {source.lastStatus && (
                    <Badge
                      variant={
                        STATUS_VARIANT[source.lastStatus as keyof typeof STATUS_VARIANT] ??
                        'neutral'
                      }
                    >
                      {source.lastStatus === 'OK' ? 'Synced' : source.lastStatus.toLowerCase()}
                    </Badge>
                  )}
                </div>
                <p className="wrap-break-word text-muted-foreground">
                  {source.kind === 'GIT' ? 'Git' : 'Archive'} · {source.url}
                  {source.ref ? ` @ ${source.ref}` : ''}
                  {source.path ? ` · /${source.path}` : ''} ·{' '}
                  {source.teamId
                    ? `${teamNames.get(source.teamId) ?? 'One team'} only`
                    : 'Everyone signed in'}
                </p>
                <p className="text-muted-foreground tabular-nums">
                  {source.documentCount} documents · last sync{' '}
                  <RelativeTime date={source.lastSyncedAt} fallback="not yet" />
                </p>
                {source.lastStatus === 'FAILED' && source.lastError && (
                  <p role="status" className="text-destructive">
                    {source.lastError}
                  </p>
                )}
                {canManage && <DocSourceButtons id={source.id} name={source.name} />}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
      {canManage && (
        <SettingsSection
          title="Add a source"
          description="Squire cites the file path and a link to it. A source limited to one team is searched only for that team's members."
        >
          <AddDocSourceForm teams={teams} />
        </SettingsSection>
      )}
    </div>
  );
}
