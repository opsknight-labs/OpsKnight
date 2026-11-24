import { History } from 'lucide-react';
import { requirePageAccess } from '@/lib/access/server';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { listSquireActionHistory } from '@/lib/intelligence/squire/actions/history';
import type { RouteSearchParams } from '@/lib/intelligence/settings/routes';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import IntelligenceSubNav from '@/components/settings/layout/IntelligenceSubNav';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import EmptyState from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui';
import SquireActionHistory from '@/components/squire/SquireActionHistory';
import { loadMoreSquireActions } from './history-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Every action someone confirmed from a Squire card, with its outcome. Read-only. */
export default async function SquireActionHistoryPage({
  searchParams,
}: {
  searchParams?: Promise<RouteSearchParams>;
}) {
  await requirePageAccess('/settings/intelligence/ai/actions');
  const params = await searchParams;
  const status = one(params?.status);
  const incident = one(params?.incident);
  const page = await listSquireActionHistory(await getCurrentAuthorizationActor(), {
    scope: one(params?.scope),
    status,
    incident,
  });

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        eyebrow="AIOps Intelligence"
        title="Squire action history"
        description="What was confirmed from a Squire card, by whom, and how it turned out."
        icon={History}
        trail={[
          { label: 'Assistant', href: '/settings/intelligence/ai' },
          { label: 'Action history' },
        ]}
      />
      <IntelligenceSubNav />
      {page ? (
        <SettingsSection
          title={page.scope === 'everyone' ? 'Everyone’s actions' : 'Your actions'}
          description="Newest first. Actions on incidents you can no longer open are not listed."
          contentClassName="p-0"
          action={
            <form method="get" className="flex flex-wrap items-end gap-2">
              {incident && <input type="hidden" name="incident" value={incident} />}
              {page.canSeeEveryone && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Show
                  <select name="scope" defaultValue={page.scope} className={selectClass}>
                    <option value="mine">Mine</option>
                    <option value="everyone">Everyone</option>
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                Status
                <select name="status" defaultValue={status ?? ''} className={selectClass}>
                  <option value="">Any</option>
                  <option value="SUCCEEDED">Succeeded</option>
                  <option value="FAILED">Failed</option>
                  <option value="UNKNOWN">Unknown</option>
                </select>
              </label>
              <Button type="submit" variant="secondary" size="sm">
                Apply
              </Button>
            </form>
          }
        >
          <SquireActionHistory
            key={`${page.scope}:${status ?? ''}:${incident ?? ''}`}
            initial={page}
            status={status}
            incident={incident}
            loadMore={loadMoreSquireActions}
          />
        </SettingsSection>
      ) : (
        <EmptyState
          title="Action history unavailable"
          description="Your role cannot use Squire suggestions, so there is no action history to show."
        />
      )}
    </div>
  );
}
