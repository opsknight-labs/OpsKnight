'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, List, Network, X } from 'lucide-react';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
import { segmentClass } from '@/components/analytics/ChartFrame';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';
import { Button } from '@/components/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { InlineNotice } from '@/components/ui/InlineNotice';
import {
  connectServicesAction,
  disconnectDependencyAction,
  getGraphNodeDetailsAction,
  reviewSuggestedDependencyAction,
  type GraphActionResult,
  type GraphNodeDetails,
} from '@/app/(app)/services/graph/actions';
import type { ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';
import { notify } from '@/lib/toast';
import GraphListView from './GraphListView';
import GraphLegend from './GraphLegend';
import GraphSidePanel, { type PanelRelation } from './GraphSidePanel';
import { GROUP_THRESHOLD, buildGraphModel, filterGraph, type GraphLink } from './model';

// React Flow and the ELK worker load only here, in the browser, after the page is interactive.
const ServiceGraphCanvas = dynamic(() => import('./ServiceGraphCanvas'), {
  ssr: false,
  loading: () => (
    <div
      role="status"
      className="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      Loading graph…
    </div>
  ),
});

export type View = 'graph' | 'list';
type Pending = { link: GraphLink; mode: 'remove' | 'review' } | null;

export type GraphExplorerParams = { q: string; team: string; impacted: boolean; view: View };

export default function ServiceGraphExplorer({
  graph,
  teams,
  canEdit,
  focusName,
  initial,
}: {
  initial: GraphExplorerParams;
  graph: ServiceGraphView;
  teams: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
  focusName: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initial.q);
  const [teamId, setTeamId] = useState(initial.team);
  const [impactedOnly, setImpactedOnly] = useState(initial.impacted);
  const [view, setView] = useState<View>(initial.view);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    graph.focus ? `${graph.focus.kind}:${graph.focus.id}` : null
  );
  const [details, setDetails] = useState<Record<string, GraphNodeDetails | null>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [saving, startSaving] = useTransition();

  // Filters live in the URL without a server round trip; focus changes are real navigations.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string) =>
      value ? params.set(key, value) : params.delete(key);
    set('q', query.trim());
    set('team', teamId);
    set('impacted', impactedOnly ? '1' : '');
    set('view', view === 'list' ? 'list' : '');
    const next = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [query, teamId, impactedOnly, view]);

  const model = useMemo(() => buildGraphModel(graph), [graph]);
  const visible = useMemo(
    () => filterGraph(model, { query, teamId, impactedOnly }),
    [model, query, teamId, impactedOnly]
  );
  const byKey = useMemo(() => new Map(model.items.map(item => [item.key, item])), [model]);
  const nameOf = useCallback(
    (key: string) => byKey.get(key)?.name ?? 'a service you cannot see',
    [byKey]
  );
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  useEffect(() => {
    if (!selected || selected.key in details) return;
    let live = true;
    getGraphNodeDetailsAction({ kind: selected.kind, id: selected.id })
      .catch(() => null)
      .then(result => {
        if (live) setDetails(current => ({ ...current, [selected.key]: result }));
      });
    return () => {
      live = false;
    };
  }, [selected, details]);

  const relations = useMemo(() => {
    if (!selected) return { dependsOn: [], usedBy: [] };
    const dependsOn: PanelRelation[] = [];
    const usedBy: PanelRelation[] = [];
    for (const link of model.links) {
      if (link.source === selected.key)
        dependsOn.push({ link, other: byKey.get(link.target) ?? null });
      if (link.target === selected.key)
        usedBy.push({ link, other: byKey.get(link.source) ?? null });
    }
    return { dependsOn, usedBy };
  }, [selected, model, byKey]);

  const run = (action: () => Promise<GraphActionResult>) =>
    startSaving(async () => {
      const result = await action().catch(() => ({
        ok: false,
        message: 'Unable to save. Refresh and try again.',
      }));
      if (result.ok) {
        notify.success(result.message);
        setDetails({});
        router.refresh();
      } else notify.error(result.message);
    });

  const linkLabel = (link: GraphLink) => `${nameOf(link.source)} → ${nameOf(link.target)}`;
  const grouped = !graph.focus && visible.items.length > GROUP_THRESHOLD;
  const filtersActive = !!query || !!teamId || impactedOnly;

  return (
    <div className="space-y-4">
      <FilterBar
        title="Filter the graph"
        description="Search by name or team, or show only what is impacted right now."
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search services…',
          label: 'Search services',
          debounceMs: 200,
        }}
        filters={
          <FilterField label="Team" htmlFor="graph-filter-team">
            <Select
              value={teamId || 'all'}
              onValueChange={value => setTeamId(value === 'all' ? '' : value)}
            >
              <SelectTrigger id="graph-filter-team" className="h-9 w-[170px] text-sm">
                <SelectValue placeholder="All teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map(team => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
        }
        chips={
          <>
            <FilterChip
              tone="critical"
              icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
              active={impactedOnly}
              onClick={() => setImpactedOnly(value => !value)}
            >
              Impacted only
            </FilterChip>
            {graph.focus && (
              <FilterChip onRemove={() => router.push('/services/graph')}>
                Focus: {focusName ?? 'not found'}
              </FilterChip>
            )}
          </>
        }
        hasActiveFilters={filtersActive}
        onClearAll={() => {
          setQuery('');
          setTeamId('');
          setImpactedOnly(false);
        }}
        actions={
          <div role="group" aria-label="View" className="inline-flex rounded-md bg-muted p-0.5">
            <button
              type="button"
              aria-pressed={view === 'graph'}
              className={segmentClass(view === 'graph')}
              onClick={() => setView('graph')}
            >
              <Network className="h-3.5 w-3.5" aria-hidden="true" /> Graph
            </button>
            <button
              type="button"
              aria-pressed={view === 'list'}
              className={segmentClass(view === 'list')}
              onClick={() => setView('list')}
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" /> List
            </button>
          </div>
        }
      />

      {graph.truncated && (
        <InlineNotice tone="info">
          This graph is large, so only part of it is shown.{' '}
          {graph.focus ? 'Narrow the focus' : 'Focus on a service'} to see everything around it.
        </InlineNotice>
      )}

      <GraphLegend grouped={grouped} canEdit={canEdit} />

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {view === 'list' ? (
            <GraphListView
              items={visible.items}
              links={visible.links}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          ) : visible.items.length === 0 ? (
            <GraphListView items={[]} links={[]} selectedKey={null} onSelect={setSelectedKey} />
          ) : (
            <div
              className="h-[70vh] min-h-[420px] overflow-hidden rounded-lg border bg-card"
              aria-label="Service dependency graph. Use the List view for a keyboard-friendly table."
              role="region"
            >
              <ServiceGraphCanvas
                items={visible.items}
                links={visible.links}
                grouped={grouped}
                selectedKey={selectedKey}
                canEdit={canEdit && !saving}
                onSelect={setSelectedKey}
                onConnect={(dependentId, dependencyId) =>
                  run(() =>
                    connectServicesAction({
                      downstreamServiceId: dependentId,
                      upstreamServiceId: dependencyId,
                    })
                  )
                }
                onLinkClick={link =>
                  canEdit && setPending({ link, mode: link.suggested ? 'review' : 'remove' })
                }
              />
            </div>
          )}
        </div>
        {selected && (
          <GraphSidePanel
            item={selected}
            dependsOn={relations.dependsOn}
            usedBy={relations.usedBy}
            details={details[selected.key]}
            nameOf={nameOf}
            canEdit={canEdit}
            onClose={() => setSelectedKey(null)}
            onDisconnect={link => setPending({ link, mode: 'remove' })}
            onReview={(link, decision) =>
              run(() =>
                reviewSuggestedDependencyAction({ dependencyId: link.dependencyId, decision })
              )
            }
          />
        )}
      </div>

      <AlertDialog open={!!pending} onOpenChange={open => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === 'review' ? 'Review suggested dependency' : 'Remove dependency?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                (pending.mode === 'review'
                  ? `The observer suggests ${linkLabel(pending.link)} (confidence ${Math.round((pending.link.confidence ?? 0) * 100)}%). Accept it to make it part of the topology, or reject it so it is not suggested again.`
                  : `${linkLabel(pending.link)} will no longer be part of the topology. Incident correlation and business-service impact stop following it.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <X className="h-4 w-4" aria-hidden="true" /> Cancel
            </AlertDialogCancel>
            {pending?.mode === 'review' ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const link = pending.link;
                    setPending(null);
                    run(() =>
                      reviewSuggestedDependencyAction({
                        dependencyId: link.dependencyId,
                        decision: 'REJECT',
                      })
                    );
                  }}
                >
                  Reject
                </Button>
                <Button
                  onClick={() => {
                    const link = pending.link;
                    setPending(null);
                    run(() =>
                      reviewSuggestedDependencyAction({
                        dependencyId: link.dependencyId,
                        decision: 'APPROVE',
                      })
                    );
                  }}
                >
                  Accept
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                onClick={() => {
                  const link = pending!.link;
                  setPending(null);
                  run(() => disconnectDependencyAction({ dependencyId: link.dependencyId }));
                }}
              >
                Remove
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {graph.focus && !focusName && (
        <p className="text-sm text-muted-foreground">
          The focused service was not found or is not visible to you.{' '}
          <Link className="underline" href="/services/graph">
            Show the whole graph
          </Link>
        </p>
      )}
    </div>
  );
}
