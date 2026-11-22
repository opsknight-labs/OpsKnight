'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Network, Unlink, X } from 'lucide-react';
import { RelativeTime, SeverityBadge } from '@/components/patterns';
import { Button } from '@/components/ui/shadcn/button';
import type { ImpactReason } from '@/lib/business-services/contract';
import { formatGraphFocus } from '@/lib/service-graph/focus';
import type { GraphNodeDetails } from '@/app/(app)/services/graph/actions';
import GraphHealthBadge, { GRAPH_STATUS_META } from './GraphHealthBadge';
import type { GraphItem, GraphLink } from './model';

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
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [item.key]);
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
        </section>
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
