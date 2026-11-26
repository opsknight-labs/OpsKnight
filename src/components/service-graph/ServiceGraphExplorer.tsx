'use client';

import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, History, List, Network, Plus, RefreshCcw, Repeat, X } from 'lucide-react';
import type { BusinessServiceTier } from '@prisma/client';
import { FilterBar, FilterChip, FilterField } from '@/components/patterns';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
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
  expandNeighboursAction,
  getGraphNodeDetailsAction,
  getGraphStatusesAction,
  reviewSuggestedDependencyAction,
  type GraphActionResult,
  type GraphNodeDetails,
} from '@/app/(app)/services/graph/actions';
import type { BsStatus } from '@/lib/business-services/contract';
import { findCycles } from '@/lib/intelligence/dependencies/graph';
import type { GraphStatuses, ServiceGraphView } from '@/lib/intelligence/dependencies/graph-view';
import { formatGraphFocus } from '@/lib/service-graph/focus';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { Emphasis } from './ServiceGraphCanvas';
import GraphDependencyDialog, { EMPTY_DRAFT, type DependencyDraft } from './GraphDependencyDialog';
import { GRAPH_STATUS_META } from './GraphHealthBadge';
import GraphLegend from './GraphLegend';
import GraphListView from './GraphListView';
import GraphSidePanel, { type PanelRelation } from './GraphSidePanel';
import GraphSkeleton from './GraphSkeleton';
import GraphInsightsPanel from './GraphInsightsPanel';
import GraphViewsMenu, { type AppliedView } from './GraphViewsMenu';
import GraphWhatIfDialog from './GraphWhatIfDialog';
import {
  markSpof,
  overlayDiff,
  snapshotView,
  type GraphDiff,
  type GraphSnapshot,
  type SpofReport,
} from './insights';
import {
  GROUP_THRESHOLD,
  applyStatuses,
  buildGraphModel,
  exportGraphJson,
  formatErrorRate,
  formatRate,
  filterGraph,
  findPath,
  impactSubgraph,
  matchItems,
  mergeViews,
  svcKey,
  type GraphLink,
  type ImpactMode,
} from './model';

// React Flow and the ELK worker load only here, in the browser, after the page is interactive.
const ServiceGraphCanvas = dynamic(() => import('./ServiceGraphCanvas'), {
  ssr: false,
  loading: () => <GraphSkeleton label="Loading graph" />,
});

/** A render or chunk-load failure in the canvas leaves the page, filters and List view usable. */
class CanvasBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <p className="text-sm font-medium">The graph could not be drawn.</p>
        <p className="text-xs text-muted-foreground">The List view shows the same services.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            this.setState({ failed: false });
            this.props.onRetry();
          }}
        >
          <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    );
  }
}

export type View = 'graph' | 'list';
type Pending = { link: GraphLink; mode: 'remove' | 'review' | 'details' } | null;

// The analytics segment control's muted label is 4.3:1 on bg-muted; ink-600 keeps AA.
const segmentClass = (active: boolean) =>
  cn(
    'inline-flex h-11 items-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring sm:h-7',
    active ? 'bg-background text-foreground shadow-xs' : 'text-ink-600 hover:text-foreground'
  );

const TIERS: Array<{ value: BusinessServiceTier; label: string }> = [
  { value: 'TIER_0', label: 'Tier 0' },
  { value: 'TIER_1', label: 'Tier 1' },
  { value: 'TIER_2', label: 'Tier 2' },
  { value: 'TIER_3', label: 'Tier 3' },
];
const STATUS_OPTIONS = Object.keys(GRAPH_STATUS_META) as BsStatus[];
const POLL_MS = 30_000;

export type GraphExplorerParams = {
  q: string;
  team: string;
  impacted: boolean;
  view: View;
  tier?: '' | BusinessServiceTier;
  status?: '' | BsStatus;
  origin?: '' | 'DECLARED' | 'OBSERVED';
  /** Search hides non-matches instead of highlighting them. */
  filterMode?: boolean;
  impact?: ImpactMode | null;
};

const CLIENT_KEYS = [
  'q',
  'team',
  'impacted',
  'view',
  'tier',
  'status',
  'origin',
  'filter',
  'impact',
];

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ServiceGraphExplorer({
  graph,
  teams,
  canEdit: canEditPermission,
  editableTeamIds = null,
  focusName,
  initial,
  hops = 2,
  incidentUnavailable = false,
  viewer,
}: {
  initial: GraphExplorerParams;
  graph: ServiceGraphView;
  teams: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
  /** Teams whose services the viewer may change; null = all (admins). */
  editableTeamIds?: readonly string[] | null;
  focusName: string | null;
  /** Hops walked around the focus (1-3). */
  hops?: number;
  /** `?incident=` named an incident that is missing or that the viewer cannot read. */
  incidentUnavailable?: boolean;
  viewer: {
    id: string;
    isAdmin: boolean;
    canOrgViews: boolean;
    seesSuggestions: boolean;
    embedEnabled: boolean;
    teams: ReadonlyArray<{ id: string; name: string }>;
  };
}) {
  const router = useRouter();
  // The loaded graph: the server's view, plus neighbours loaded on request and local edits. A new
  // server view (navigation) replaces it.
  const [data, setData] = useState(graph);
  const [live, setLive] = useState<GraphStatuses | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    setData(graph);
    setLive(null);
  }, [graph]);

  const [query, setQuery] = useState(initial.q);
  const [filterMode, setFilterMode] = useState(!!initial.filterMode);
  const [teamId, setTeamId] = useState(initial.team);
  const [tier, setTier] = useState(initial.tier ?? '');
  const [status, setStatus] = useState(initial.status ?? '');
  const [origin, setOrigin] = useState(initial.origin ?? '');
  const [impactedOnly, setImpactedOnly] = useState(initial.impacted);
  const [view, setView] = useState<View>(initial.view);
  const incidentKey = graph.incident ? svcKey(graph.incident.serviceId) : null;
  const [impactMode, setImpactMode] = useState<ImpactMode | null>(
    initial.impact ?? (incidentKey ? 'root' : null)
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    incidentKey ?? (graph.focus ? formatGraphFocus(graph.focus) : null)
  );
  const [keyboardSelect, setKeyboardSelect] = useState(false);
  const select = (key: string | null, fromKeyboard = false) => {
    setKeyboardSelect(fromKeyboard);
    setSelectedKey(key);
  };
  const [path, setPath] = useState<{ from: string | null; to: string | null }>({
    from: null,
    to: null,
  });
  const [showCycles, setShowCycles] = useState(false);
  const [details, setDetails] = useState<Record<string, GraphNodeDetails | null>>({});
  const [pending, setPending] = useState<Pending>(null);
  const [dialog, setDialog] = useState<{ draft: DependencyDraft; fixedEnds: boolean } | null>(null);
  const [saving, startSaving] = useTransition();
  const [loadingNeighbours, setLoadingNeighbours] = useState(false);
  const [canvasAttempt, setCanvasAttempt] = useState(0);
  // Insights: a past moment (read-only), the changes overlay, single points of failure, what-if.
  const [travel, setTravel] = useState<{ snapshot: GraphSnapshot; at: Date } | null>(null);
  const [diff, setDiff] = useState<GraphDiff | null>(null);
  const [spof, setSpof] = useState<SpofReport | null>(null);
  const [whatIf, setWhatIf] = useState<{ id: string; name: string } | null>(null);
  // Looking at the past never edits: the edges there are a replay, not rows.
  const canEdit = canEditPermission && !travel;
  const onTravel = useCallback(
    (snapshot: GraphSnapshot | null, at: Date | null) => setTravel(snapshot && at ? { snapshot, at } : null),
    []
  );
  const exportSvg = useRef<(() => string) | null>(null);
  const onExportReady = useCallback((fn: (() => string) | null) => {
    exportSvg.current = fn;
  }, []);

  const filterSearch = useCallback(() => {
    const params = new URLSearchParams();
    const set = (key: string, value: string) => value && params.set(key, value);
    set('q', query.trim());
    set('team', teamId);
    set('impacted', impactedOnly ? '1' : '');
    set('view', view === 'list' ? 'list' : '');
    set('tier', tier);
    set('status', status);
    set('origin', origin);
    set('filter', filterMode ? '1' : '');
    set('impact', impactMode ?? '');
    return params;
  }, [query, teamId, impactedOnly, view, tier, status, origin, filterMode, impactMode]);

  // Filters live in the URL without a server round trip; focus, hops and incident changes are real navigations.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const key of CLIENT_KEYS) params.delete(key);
    for (const [key, value] of filterSearch()) params.set(key, value);
    const next = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
  }, [filterSearch]);

  const applyView = (applied: AppliedView) => {
    const current = data.focus ? formatGraphFocus(data.focus) : null;
    if (applied.focus !== current || (applied.focus && applied.hops && applied.hops !== hops))
      navigate(params => {
        if (applied.focus) params.set('focus', applied.focus);
        else params.delete('focus');
        if (applied.hops) params.set('hops', String(applied.hops));
        params.delete('incident');
      });
    applySearch(applied.search);
  };

  const applySearch = (search: string) => {
    const params = new URLSearchParams(search);
    setQuery(params.get('q') ?? '');
    setTeamId(params.get('team') ?? '');
    setImpactedOnly(params.get('impacted') === '1');
    setView(params.get('view') === 'list' ? 'list' : 'graph');
    setTier((TIERS.find(t => t.value === params.get('tier'))?.value ?? '') as typeof tier);
    setStatus((STATUS_OPTIONS.find(s => s === params.get('status')) ?? '') as typeof status);
    const nextOrigin = params.get('origin');
    setOrigin(nextOrigin === 'DECLARED' || nextOrigin === 'OBSERVED' ? nextOrigin : '');
    setFilterMode(params.get('filter') === '1');
    const nextImpact = params.get('impact');
    setImpactMode(nextImpact === 'blast' || nextImpact === 'root' ? nextImpact : null);
  };

  const baseModel = useMemo(
    () => buildGraphModel(travel ? snapshotView(data, travel.snapshot) : data),
    [data, travel]
  );
  const model = useMemo(() => {
    const items = live && !travel ? applyStatuses(baseModel.items, live) : baseModel.items;
    return items === baseModel.items ? baseModel : { ...baseModel, items: [...items] };
  }, [baseModel, live, travel]);
  const visible = useMemo(
    () =>
      filterGraph(model, {
        query: filterMode ? query : '',
        teamId,
        impactedOnly,
        tiers: tier ? [tier] : [],
        statuses: status ? [status] : [],
        origin,
      }),
    [model, query, filterMode, teamId, impactedOnly, tier, status, origin]
  );
  const byKey = useMemo(() => new Map(model.items.map(item => [item.key, item])), [model]);
  const nameOf = useCallback(
    (key: string) => byKey.get(key)?.name ?? 'a service you cannot see',
    [byKey]
  );
  const selected = selectedKey ? (byKey.get(selectedKey) ?? null) : null;

  // Live status without relayout: only statuses are fetched, for the nodes already loaded, and only
  // while the tab is visible. Layout inputs never change, so nothing moves.
  const serviceIds = useMemo(() => data.nodes.map(node => node.id), [data.nodes]);
  const businessIds = useMemo(
    () => data.businessServices.map(bs => bs.id),
    [data.businessServices]
  );
  useEffect(() => {
    let stopped = false;
    let inFlight = false; // a slow response must not stack requests behind the timer
    const poll = async () => {
      if (document.hidden || inFlight) return;
      inFlight = true;
      try {
        const next = await getGraphStatusesAction({
          services: serviceIds,
          businessServices: businessIds,
        }).catch(() => null);
        if (!stopped && next) setLive(next);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    const onVisible = () => !document.hidden && void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [serviceIds, businessIds]);

  useEffect(() => {
    if (!selected || selected.key in details) return;
    let alive = true;
    getGraphNodeDetailsAction({ kind: selected.kind, id: selected.id })
      .catch(() => null)
      .then(result => {
        if (alive) setDetails(current => ({ ...current, [selected.key]: result }));
      });
    return () => {
      alive = false;
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

  // What the canvas lights up: a path between two picked nodes, else dependency cycles, else the
  // blast radius / root-cause path of the selected node.
  const cycles = useMemo(
    () =>
      findCycles(
        data.edges.filter(edge => edge.status === 'ACTIVE'),
        10
      ),
    [data.edges]
  );
  const pathResult = useMemo(
    () => (path.from && path.to ? findPath(visible.links, path.from, path.to) : null),
    [path, visible.links]
  );
  const impact = useMemo(
    () =>
      impactMode && selectedKey && byKey.has(selectedKey)
        ? impactSubgraph(visible.links, selectedKey, impactMode)
        : null,
    [impactMode, selectedKey, visible.links, byKey]
  );
  const emphasis = useMemo<Emphasis | null>(() => {
    if (pathResult)
      return { keys: new Set(pathResult.keys), linkKeys: new Set(pathResult.linkKeys) };
    if (showCycles && cycles.length) {
      const keys = new Set(cycles.flat().map(svcKey));
      return {
        keys,
        linkKeys: new Set(
          visible.links
            .filter(
              link => link.kind === 'dependency' && keys.has(link.source) && keys.has(link.target)
            )
            .map(link => link.key)
        ),
      };
    }
    return impact ? { keys: impact.keys, linkKeys: impact.linkKeys } : null;
  }, [pathResult, showCycles, cycles, visible.links, impact]);

  // Search highlights and jumps; it only hides non-matches when "Hide non-matches" is on.
  const matches = useMemo(
    () => (filterMode ? [] : matchItems(visible.items, query)),
    [filterMode, visible.items, query]
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const matchSignature = matches.join('|');
  const [fitToken, setFitToken] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    if (matchSignature) setFitToken(token => token + 1);
  }, [matchSignature]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state with the prop/open transition; cannot be derived during render
    if (pathResult) setFitToken(token => token + 1);
  }, [pathResult]);
  const fit = useMemo(
    () => {
      const keys = pathResult?.keys ?? matches;
      return keys.length ? { keys, token: fitToken } : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fit only when the token changes
    [fitToken]
  );

  const announcement = selected
    ? `${selected.name}, ${GRAPH_STATUS_META[selected.status]?.label ?? selected.status}. Depends on ${relations.dependsOn.length}, used by ${relations.usedBy.length}.`
    : '';

  const run = (
    action: () => Promise<GraphActionResult>,
    // Applies the change to the loaded graph; without it (or when it cannot) the page is refetched.
    patch?: () => Promise<ServiceGraphView | null> | ServiceGraphView | null
  ) =>
    startSaving(async () => {
      const result = await action().catch(() => ({
        ok: false,
        message: 'Unable to save. Refresh and try again.',
      }));
      if (!result.ok) {
        notify.error(result.message);
        return;
      }
      notify.success(result.message);
      setDetails({});
      const next = await Promise.resolve(patch?.()).catch(() => null);
      if (next) setData(next);
      else router.refresh();
    });

  const submitDependency = (draft: DependencyDraft) => {
    setDialog(null);
    run(
      () =>
        connectServicesAction({
          downstreamServiceId: draft.dependentId,
          upstreamServiceId: draft.dependencyId,
          dependencyType: draft.dependencyType,
          note: draft.note.trim() || null,
          criticality: draft.criticality || null,
        }),
      async () => {
        const fresh = await expandNeighboursAction({ serviceId: draft.dependentId });
        return fresh ? mergeViews(data, fresh, draft.dependentId) : null;
      }
    );
  };
  const removeEdge = (dependencyId: string | null) =>
    dependencyId ? { ...data, edges: data.edges.filter(edge => edge.id !== dependencyId) } : null;
  const reviewEdge = (link: GraphLink, decision: 'APPROVE' | 'REJECT') =>
    run(
      () => reviewSuggestedDependencyAction({ dependencyId: link.dependencyId, decision }),
      () =>
        decision === 'REJECT'
          ? removeEdge(link.dependencyId)
          : {
              ...data,
              edges: data.edges.map(edge =>
                edge.id === link.dependencyId ? { ...edge, status: 'ACTIVE' as const } : edge
              ),
            }
    );

  const loadNeighbours = async (serviceId: string) => {
    setLoadingNeighbours(true);
    const fresh = await expandNeighboursAction({ serviceId }).catch(() => null);
    setLoadingNeighbours(false);
    if (fresh) setData(current => mergeViews(current, fresh, serviceId));
    else notify.error('Unable to load neighbours. Try again.');
  };

  const navigate = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    router.replace(`${window.location.pathname}?${params.toString()}`);
  };

  const linkLabel = (link: GraphLink) => `${nameOf(link.source)} → ${nameOf(link.target)}`;
  const grouped = !data.focus && visible.items.length > GROUP_THRESHOLD;
  const filtersActive = !!query || !!teamId || impactedOnly || !!tier || !!status || !!origin;
  const serviceOptions = useMemo(
    () =>
      model.items
        .filter(item => item.kind === 'svc')
        .map(item => ({ id: item.id, name: item.name, teamId: item.teamId })),
    [model.items]
  );
  const editableOptions = useMemo(
    () =>
      serviceOptions.filter(
        option => !editableTeamIds || editableTeamIds.includes(option.teamId ?? '')
      ),
    [serviceOptions, editableTeamIds]
  );
  const spofIds = useMemo(() => new Set(spof?.singlePointsOfFailure.map(row => row.serviceId)), [spof]);
  const canvasItems = useMemo(() => markSpof(visible.items, spofIds), [visible.items, spofIds]);
  const canvasLinks = useMemo(
    () => (diff ? overlayDiff(visible.items, visible.links, diff) : visible.links),
    [visible, diff]
  );
  const atBoundary =
    selected?.kind === 'svc' && (data.boundaryIds ?? []).includes(selected.id) ? selected : null;
  const candidateCauses =
    graph.incident && impact && impactMode === 'root'
      ? [...impact.keys]
          .map(key => byKey.get(key))
          .filter(item => item && item.key !== incidentKey && item.openIncidents > 0)
      : [];
  const pendingDetails = pending?.link;
  const layoutId = `${data.focus ? formatGraphFocus(data.focus) : 'all'}:${hops}:${graph.incident?.id ?? ''}`;

  return (
    <div className="space-y-4">
      <FilterBar
        title="Filter the graph"
        description="Search highlights matches; narrow by team, tier, status or origin, or show only what is impacted right now."
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search services…',
          label: 'Search services',
          debounceMs: 200,
        }}
        filters={
          <>
            <FilterField label="Team" htmlFor="graph-filter-team">
              <Select
                value={teamId || 'all'}
                onValueChange={value => setTeamId(value === 'all' ? '' : value)}
              >
                <SelectTrigger id="graph-filter-team" className="h-9 w-[150px] text-sm">
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
            <FilterField label="Tier" htmlFor="graph-filter-tier">
              <Select
                value={tier || 'all'}
                onValueChange={value => setTier(value === 'all' ? '' : (value as typeof tier))}
              >
                <SelectTrigger id="graph-filter-tier" className="h-9 w-[110px] text-sm">
                  <SelectValue placeholder="Any tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any tier</SelectItem>
                  {TIERS.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Status" htmlFor="graph-filter-status">
              <Select
                value={status || 'all'}
                onValueChange={value => setStatus(value === 'all' ? '' : (value as BsStatus))}
              >
                <SelectTrigger id="graph-filter-status" className="h-9 w-[150px] text-sm">
                  <SelectValue placeholder="Any status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any status</SelectItem>
                  {STATUS_OPTIONS.map(option => (
                    <SelectItem key={option} value={option}>
                      {/* eslint-disable-next-line security/detect-object-injection -- key is a closed typed union / internal name, never request input */}
                      {GRAPH_STATUS_META[option].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
            <FilterField label="Origin" htmlFor="graph-filter-origin">
              <Select
                value={origin || 'all'}
                onValueChange={value => setOrigin(value === 'all' ? '' : (value as typeof origin))}
              >
                <SelectTrigger id="graph-filter-origin" className="h-9 w-[130px] text-sm">
                  <SelectValue placeholder="Any origin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any origin</SelectItem>
                  <SelectItem value="DECLARED">Declared</SelectItem>
                  <SelectItem value="OBSERVED">Observed</SelectItem>
                </SelectContent>
              </Select>
            </FilterField>
          </>
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
            <FilterChip active={filterMode} onClick={() => setFilterMode(value => !value)}>
              Hide non-matches
            </FilterChip>
            {cycles.length > 0 && (
              <FilterChip
                tone="critical"
                icon={<Repeat className="h-3.5 w-3.5" aria-hidden="true" />}
                active={showCycles}
                onClick={() => setShowCycles(value => !value)}
              >
                {cycles.length === 1 ? '1 dependency cycle' : `${cycles.length} dependency cycles`}
              </FilterChip>
            )}
            {data.focus && (
              <FilterChip onRemove={() => router.push('/services/graph')}>
                Focus: {focusName ?? 'not found'}
              </FilterChip>
            )}
            {(path.from || path.to) && (
              <FilterChip onRemove={() => setPath({ from: null, to: null })}>
                Path: {path.from ? nameOf(path.from) : '…'} → {path.to ? nameOf(path.to) : '…'}
              </FilterChip>
            )}
          </>
        }
        hasActiveFilters={filtersActive}
        onClearAll={() => {
          setQuery('');
          setTeamId('');
          setTier('');
          setStatus('');
          setOrigin('');
          setImpactedOnly(false);
        }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data.focus && (
              <div
                role="group"
                aria-label="Hops around the focus"
                className="inline-flex rounded-md bg-muted p-0.5"
              >
                {[1, 2, 3].map(count => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={hops === count}
                    aria-label={`${count} hop${count === 1 ? '' : 's'}`}
                    className={segmentClass(hops === count)}
                    onClick={() => navigate(params => params.set('hops', String(count)))}
                  >
                    {count} hop{count === 1 ? '' : 's'}
                  </button>
                ))}
              </div>
            )}
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
            <GraphViewsMenu
              focus={data.focus ? formatGraphFocus(data.focus) : null}
              hops={hops}
              currentSearch={() => filterSearch().toString()}
              currentMode={view}
              onApply={applyView}
              userId={viewer.id}
              teams={viewer.teams}
              canOrg={viewer.canOrgViews}
              isAdmin={viewer.isAdmin}
              embedEnabled={viewer.embedEnabled}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Download className="h-4 w-4" aria-hidden="true" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    download('service-graph.json', exportGraphJson(visible), 'application/json')
                  }
                >
                  JSON (loaded graph)
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={view !== 'graph'}
                  onSelect={() => {
                    const svg = exportSvg.current?.();
                    if (svg) download('service-graph.svg', svg, 'image/svg+xml');
                    else notify.error('The graph is still laying out.');
                  }}
                >
                  SVG (current layout)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canEdit && (
              <Button
                size="sm"
                onClick={() =>
                  setDialog({
                    fixedEnds: false,
                    draft: {
                      ...EMPTY_DRAFT,
                      dependentId:
                        selected?.kind === 'svc' && editableOptions.some(o => o.id === selected.id)
                          ? selected.id
                          : '',
                    },
                  })
                }
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Add dependency
              </Button>
            )}
          </div>
        }
      />

      <p aria-live="polite" className="sr-only">
        {query && !filterMode
          ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} for ${query}`
          : ''}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {query.trim() && !filterMode && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold tabular-nums text-foreground">{matches.length}</span>{' '}
          {matches.length === 1 ? 'match' : 'matches'} highlighted
          {matches.length === 0 && ' — try a different name or turn on "Hide non-matches"'}
        </p>
      )}

      {incidentUnavailable && (
        <InlineNotice tone="warning">
          That incident was not found, or you cannot view it. Showing the whole graph.
        </InlineNotice>
      )}
      {graph.incident && (
        <InlineNotice tone="info">
          <span>
            Scoped to incident{' '}
            <Link className="font-medium underline" href={`/incidents/${graph.incident.id}`}>
              {graph.incident.title}
            </Link>
            . The root-cause path from {nameOf(incidentKey ?? '')} is highlighted
            {candidateCauses.length > 0
              ? `; upstream services with open incidents: ${candidateCauses.map(item => item?.name).join(', ')}.`
              : '; no upstream service has an open incident.'}{' '}
            <Link className="underline" href="/services/graph">
              Show the whole graph
            </Link>
          </span>
        </InlineNotice>
      )}
      {cycles.length > 0 && showCycles && (
        <InlineNotice tone="warning">
          <span>
            Dependency cycles make impact analysis ambiguous:{' '}
            {cycles
              .slice(0, 3)
              .map(cycle => cycle.map(id => nameOf(svcKey(id))).join(' ↔ '))
              .join('; ')}
            {cycles.length > 3 ? '…' : ''}
          </span>
        </InlineNotice>
      )}
      {pathResult === null && path.from && path.to && (
        <InlineNotice tone="warning">
          No dependency path connects {nameOf(path.from)} and {nameOf(path.to)} in the loaded graph.
        </InlineNotice>
      )}
      {data.truncated && (
        <InlineNotice tone="info">
          This graph is large, so only part of it is shown.{' '}
          {data.focus
            ? 'Narrow the focus, or select a service marked as having more neighbours and load them.'
            : 'Focus on a service, or select one at the edge of what is shown and load its neighbours.'}
        </InlineNotice>
      )}
      {atBoundary && (
        <InlineNotice tone="neutral">
          <span className="flex flex-wrap items-center gap-2">
            {atBoundary.name} may have dependencies that are not shown.
            <Button
              size="sm"
              variant="outline"
              disabled={loadingNeighbours}
              onClick={() => loadNeighbours(atBoundary.id)}
            >
              Load neighbours
            </Button>
          </span>
        </InlineNotice>
      )}

      {travel && (
        <InlineNotice tone="info">
          <span className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4" aria-hidden="true" />
            Viewing the graph as of <strong>{travel.at.toLocaleString()}</strong>. This is read-only.
            <Button size="sm" variant="outline" onClick={() => setTravel(null)}>
              Back to now
            </Button>
          </span>
        </InlineNotice>
      )}

      <GraphInsightsPanel
        focus={data.focus ? formatGraphFocus(data.focus) : null}
        hops={hops}
        seesSuggestions={viewer.seesSuggestions}
        at={travel?.at ?? null}
        onTravel={onTravel}
        onDiff={setDiff}
        onSpof={setSpof}
        onShowSuggested={() => setOrigin('OBSERVED')}
        onSelectService={serviceId => select(svcKey(serviceId))}
      />

      <GraphLegend grouped={grouped} canEdit={canEdit} />
      <p className="text-2xs text-muted-foreground">
        Statuses refresh every 30 seconds while this tab is open.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {view === 'list' ? (
            <GraphListView
              items={visible.items}
              links={visible.links}
              selectedKey={selectedKey}
              onSelect={key => select(key)}
              matches={matchSet}
            />
          ) : visible.items.length === 0 ? (
            <GraphListView items={[]} links={[]} selectedKey={null} onSelect={key => select(key)} />
          ) : (
            <div
              className="h-[70vh] min-h-[420px] overflow-hidden rounded-lg border bg-card"
              aria-label="Service dependency graph. Focus a service and use the arrow keys to move along dependencies, or use the List view for a table."
              role="region"
            >
              <CanvasBoundary key={canvasAttempt} onRetry={() => setCanvasAttempt(n => n + 1)}>
                <ServiceGraphCanvas
                  key={layoutId}
                  layoutId={layoutId}
                  items={canvasItems}
                  links={canvasLinks}
                  grouped={grouped}
                  selectedKey={selectedKey}
                  canEdit={canEdit && !saving}
                  editableTeamIds={editableTeamIds}
                  emphasis={emphasis}
                  matches={matchSet}
                  fit={fit}
                  onExportReady={onExportReady}
                  onSelect={key => select(key, true)}
                  onConnect={(dependentId, dependencyId) =>
                    submitDependency({ ...EMPTY_DRAFT, dependentId, dependencyId })
                  }
                  onLinkClick={link =>
                    link.diff !== 'removed' &&
                    setPending({
                      link,
                      mode: link.suggested && canEdit ? 'review' : canEdit ? 'remove' : 'details',
                    })
                  }
                />
              </CanvasBoundary>
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
            focusOnSelect={!keyboardSelect}
            impactMode={impactMode}
            onImpactMode={setImpactMode}
            onPathPoint={end => {
              setPath(current => ({ ...current, [end]: selected.key }));
            }}
            incidentsHref={
              selected.kind === 'svc'
                ? `/incidents?serviceId=${encodeURIComponent(selected.id)}`
                : `/services/business/${selected.id}`
            }
            onWhatIf={
              selected.kind === 'svc' && !travel
                ? () => setWhatIf({ id: selected.id, name: selected.name })
                : undefined
            }
            onClose={() => select(null)}
            onDisconnect={link => setPending({ link, mode: 'remove' })}
            onReview={reviewEdge}
          />
        )}
      </div>

      <GraphWhatIfDialog service={whatIf} onClose={() => setWhatIf(null)} />

      <GraphDependencyDialog
        open={!!dialog}
        onOpenChange={open => !open && setDialog(null)}
        dependents={editableOptions}
        dependencies={serviceOptions}
        initial={dialog?.draft ?? EMPTY_DRAFT}
        fixedEnds={dialog?.fixedEnds}
        saving={saving}
        onSubmit={submitDependency}
      />

      <AlertDialog open={!!pending} onOpenChange={open => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.mode === 'review'
                ? 'Review suggested dependency'
                : pending?.mode === 'details'
                  ? 'Dependency'
                  : 'Remove dependency?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                (pending.mode === 'review'
                  ? `The observer suggests ${linkLabel(pending.link)} (confidence ${Math.round((pending.link.confidence ?? 0) * 100)}%). Accept it to make it part of the topology, or reject it so it is not suggested again.`
                  : pending.mode === 'details'
                    ? linkLabel(pending.link)
                    : `${linkLabel(pending.link)} will no longer be part of the topology. Incident correlation and business-service impact stop following it.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingDetails && (
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Type</dt>
              <dd>
                {pendingDetails.dependencyType === 'SOFT'
                  ? 'Soft (degrades gracefully)'
                  : 'Hard (fails with it)'}
              </dd>
              <dt className="text-muted-foreground">Origin</dt>
              <dd>{pendingDetails.origin === 'OBSERVED' ? 'Observed' : 'Declared'}</dd>
              {pendingDetails.traffic && (
                <>
                  <dt className="text-muted-foreground">Traffic</dt>
                  <dd className="tabular-nums">
                    {formatRate(pendingDetails.traffic.requestRate)} requests,{' '}
                    {formatErrorRate(pendingDetails.traffic.errorRate)} errors
                    <span className="block text-xs text-muted-foreground">
                      Window starting {new Date(pendingDetails.traffic.windowStart).toLocaleString()}
                    </span>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Confidence</dt>
              <dd className="tabular-nums">
                {Math.round((pendingDetails.confidence ?? 0) * 100)}%
              </dd>
              {pendingDetails.criticality && (
                <>
                  <dt className="text-muted-foreground">Criticality</dt>
                  <dd className="capitalize">{pendingDetails.criticality.toLowerCase()}</dd>
                </>
              )}
              {pendingDetails.evidence && (
                <>
                  <dt className="text-muted-foreground">Evidence</dt>
                  <dd>{pendingDetails.evidence}</dd>
                </>
              )}
              {pendingDetails.note && (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd className="whitespace-pre-wrap break-words">{pendingDetails.note}</dd>
                </>
              )}
            </dl>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>
              <X className="h-4 w-4" aria-hidden="true" />{' '}
              {pending?.mode === 'details' ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            {pending?.mode === 'review' ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    const link = pending.link;
                    setPending(null);
                    reviewEdge(link, 'REJECT');
                  }}
                >
                  Reject
                </Button>
                <Button
                  onClick={() => {
                    const link = pending.link;
                    setPending(null);
                    reviewEdge(link, 'APPROVE');
                  }}
                >
                  Accept
                </Button>
              </>
            ) : pending?.mode === 'remove' ? (
              <>
                {pending.link.origin === 'DECLARED' && pending.link.kind === 'dependency' && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const link = pending.link;
                      setPending(null);
                      setDialog({
                        fixedEnds: true,
                        draft: {
                          dependentId: link.source.slice(4),
                          dependencyId: link.target.slice(4),
                          dependencyType: link.dependencyType ?? 'HARD',
                          note: link.note ?? '',
                          criticality: link.criticality ?? '',
                        },
                      });
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button
                  variant="destructive"
                  onClick={() => {
                    const link = pending.link;
                    setPending(null);
                    run(
                      () => disconnectDependencyAction({ dependencyId: link.dependencyId }),
                      () => removeEdge(link.dependencyId)
                    );
                  }}
                >
                  Remove
                </Button>
              </>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {data.focus && !focusName && (
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
