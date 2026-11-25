'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Crosshair, Network, Power, Route, Unlink, Waypoints, X } from 'lucide-react';
import { RelativeTime, SeverityBadge } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import type { ImpactReason } from '@/lib/business-services/contract';
import { formatGraphFocus } from '@/lib/service-graph/focus';
import type { GraphNodeDetails } from '@/app/(app)/services/graph/actions';
import GraphHealthBadge, { GRAPH_STATUS_META } from './GraphHealthBadge';
import type { GraphItem, GraphLink, ImpactMode } from './model';

export type PanelRelation = { link: GraphLink; other: GraphItem | null };

type Props = {
  item: GraphItem;
  dependsOn: readonly PanelRelation[];
  usedBy: readonly PanelRelation[];
  /** undefined while loading; null when it could not be loaded. */
  details: GraphNodeDetails | null | undefined;
  nameOf: (key: string) => string;
  canEdit: boolean;
  onClose: () => void;
  onDisconnect: (link: GraphLink) => void;
  onReview: (link: GraphLink, decision: 'APPROVE' | 'REJECT') => void;
  /** Move focus to the heading when the selection changes. Off while arrow keys walk the canvas. */
  focusOnSelect?: boolean;
  impactMode?: ImpactMode | null;
  onImpactMode?: (mode: ImpactMode | null) => void;
  /** Start or end a path between two nodes. */
  onPathPoint?: (end: 'from' | 'to') => void;
  /** Opens the failure simulation for this (technical) service. */
  onWhatIf?: () => void;
  /** How many of the node's open incidents the panel lists before linking to the full list. */
  incidentsHref?: string | null;
};

function reasonText(reason: ImpactReason, nameOf: (key: string) => string): string {
  const label = GRAPH_STATUS_META[reason.status]?.label ?? reason.status;
  switch (reason.kind) {
    case 'DIRECT':
      return `${label}: open incident on ${nameOf(`svc:${reason.serviceId}`)}`;
    case 'DEPENDENCY':
      return `${label}: ${nameOf(`svc:${reason.viaServiceId}`)} depends on ${nameOf(`svc:${reason.serviceId}`)}, which has an open incident`;
    case 'NESTED':
      return `${label}: supporting service ${nameOf(`bs:${reason.childBusinessServiceId}`)} is impacted`;
    case 'MANUAL':
      return `${label}: marked impacted on an incident`;
    case 'MAINTENANCE':
      return 'Under maintenance';
    case 'CUSTOMER_REPORTS':
      return `${label}: customers reported problems (${reason.reportCount} in ${reason.windowMinutes} minutes)`;
  }
}

/** The right-hand panel for the selected node. Focus moves to its heading when it opens. */
export default function GraphSidePanel({
  item,
  dependsOn,
  usedBy,
  details,
  nameOf,
  canEdit,
  onClose,
  onDisconnect,
  onReview,
  focusOnSelect = true,
  impactMode = null,
  onImpactMode,
  onPathPoint,
  onWhatIf,
  incidentsHref = null,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusOnSelect) heading.current?.focus();
  }, [item.key, focusOnSelect]);
  const overview = item.kind === 'bs' ? `/services/business/${item.id}` : `/services/${item.id}`;
  const manage =
    item.kind === 'bs'
      ? `/services/business/${item.id}?tab=dependencies`
      : `/services/${item.id}?tab=intelligence`;

  const relationList = (title: string, relations: readonly PanelRelation[]) => (
    <section className="space-y-1.5">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({relations.length})</span>
      </h3>
      {relations.length === 0 ? (
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="space-y-1">
          {relations.map(({ link, other }) => (
            <li key={link.key} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate" title={other?.name}>
                {other?.name ?? 'Hidden service'}
                {link.kind === 'member' && (
                  <span className="text-xs text-muted-foreground"> · member</span>
                )}
                {link.kind === 'support' && (
                  <span className="text-xs text-muted-foreground"> · supporting</span>
                )}
                {link.suggested && (
                  <span className="text-xs text-muted-foreground"> · suggested</span>
                )}
                {link.kind === 'dependency' && link.dependencyType === 'SOFT' && (
                  <span className="text-xs text-muted-foreground"> · soft</span>
                )}
              </span>
              {canEdit && link.kind === 'dependency' && link.suggested && (
                <>
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    variant="outline"
                    onClick={() => onReview(link, 'APPROVE')}
                    aria-label={`Accept suggested dependency with ${other?.name ?? 'service'}`}
                  >
                    <Check className="h-3 w-3" aria-hidden="true" /> Accept
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 px-2 text-xs"
                    variant="ghost"
                    onClick={() => onReview(link, 'REJECT')}
                    aria-label={`Reject suggested dependency with ${other?.name ?? 'service'}`}
                  >
                    Reject
                  </Button>
                </>
              )}
              {canEdit && link.kind === 'dependency' && !link.suggested && (
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant="ghost"
                  onClick={() => onDisconnect(link)}
                  aria-label={`Remove dependency with ${other?.name ?? 'service'}`}
                >
                  <Unlink className="h-3 w-3" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <aside
      aria-labelledby="graph-panel-title"
      className="flex max-h-[70vh] w-full flex-col overflow-y-auto rounded-lg border bg-card shadow-xs lg:max-h-none lg:w-80 lg:shrink-0"
      onKeyDown={event => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            {item.kind === 'bs' ? 'Business service' : 'Technical service'}
          </p>
          <h2
            id="graph-panel-title"
            ref={heading}
            tabIndex={-1}
            className="truncate text-base font-semibold focus-visible:outline-hidden"
            title={item.name}
          >
            {item.name}
          </h2>
        </div>
        <Button
          size="icon"
          className="h-8 w-8"
          variant="ghost"
          onClick={onClose}
          aria-label="Close details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>
      <div className="space-y-4 px-4 py-3">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <GraphHealthBadge status={item.status} />
          </dd>
          <dt className="text-muted-foreground">{item.kind === 'bs' ? 'Owner' : 'Team'}</dt>
          <dd className="truncate">{details?.owner?.name ?? item.teamName ?? 'Unassigned'}</dd>
          {item.kind === 'svc' && (
            <>
              <dt className="text-muted-foreground">On call now</dt>
              <dd className="min-w-0">
                {details === undefined ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : details?.onCall && details.onCall.names.length ? (
                  <span className="truncate" title={details.onCall.label}>
                    {details.onCall.names.join(', ')}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No one</span>
                )}
              </dd>
            </>
          )}
        </dl>
        {item.reasons.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Why
            </h3>
            <ul className="list-disc space-y-1 pl-4 text-xs">
              {item.reasons.slice(0, 5).map((reason, index) => (
                <li key={index}>{reasonText(reason, nameOf)}</li>
              ))}
            </ul>
          </section>
        )}
        <section className="space-y-1.5">
          <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            Open incidents <span className="tabular-nums">({item.openIncidents})</span>
          </h3>
          {details === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : details && details.incidents.length > 0 ? (
            <ul className="space-y-1.5">
              {details.incidents.map(incident => (
                <li key={incident.id} className="flex items-center gap-2 text-sm">
                  <SeverityBadge
                    urgency={incident.urgency}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    abbreviate
                  />
                  <Link
                    href={`/incidents/${incident.id}`}
                    className="min-w-0 flex-1 truncate hover:underline"
                  >
                    {incident.title}
                  </Link>
                  <RelativeTime date={incident.createdAt} format="narrow" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {item.openIncidents > 0 ? 'None you can open.' : 'None.'}
            </p>
          )}
          {incidentsHref && item.openIncidents > 0 && (
            <Link
              href={incidentsHref}
              className="text-xs font-medium underline-offset-2 hover:underline"
            >
              Show all incidents
            </Link>
          )}
        </section>
        {onImpactMode && (
          <section className="space-y-1.5" aria-label="Impact view">
            <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Highlight
            </h3>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={impactMode === 'blast' ? 'default' : 'outline'}
                aria-pressed={impactMode === 'blast'}
                onClick={() => onImpactMode(impactMode === 'blast' ? null : 'blast')}
              >
                <Crosshair className="h-4 w-4" aria-hidden="true" /> Blast radius
              </Button>
              <Button
                size="sm"
                variant={impactMode === 'root' ? 'default' : 'outline'}
                aria-pressed={impactMode === 'root'}
                onClick={() => onImpactMode(impactMode === 'root' ? null : 'root')}
              >
                <Route className="h-4 w-4" aria-hidden="true" /> Root-cause path
              </Button>
              {onPathPoint && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => onPathPoint('from')}>
                    <Waypoints className="h-4 w-4" aria-hidden="true" /> Path from here
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onPathPoint('to')}>
                    Path to here
                  </Button>
                </>
              )}
            </div>
          </section>
        )}
        {onWhatIf && item.kind === 'svc' && (
          <section aria-label="Failure simulation">
            <Button size="sm" variant="outline" onClick={onWhatIf}>
              <Power className="h-4 w-4" aria-hidden="true" /> What if this goes down?
            </Button>
          </section>
        )}
        {relationList('Depends on', dependsOn)}
        {relationList('Used by', usedBy)}
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button asChild size="sm" variant="outline">
            <Link href={overview}>
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {item.kind === 'bs' ? 'Overview' : 'Service page'}
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/services/graph?focus=${formatGraphFocus(item)}`}>
              <Network className="h-4 w-4" aria-hidden="true" />
              Focus
            </Link>
          </Button>
          {canEdit && (
            <Button asChild size="sm" variant="ghost">
              <Link href={manage}>Manage dependencies</Link>
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
