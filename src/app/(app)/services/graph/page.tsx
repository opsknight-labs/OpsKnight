import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Network, Server, TriangleAlert } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/patterns';
import ServiceGraphExplorer from '@/components/service-graph/ServiceGraphExplorer';
import { requirePageAccess } from '@/lib/access/server';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { teamReadWhere } from '@/lib/authorization-filters';
import { getServiceGraphForActor } from '@/lib/intelligence/dependencies/graph-view';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { parseGraphFocus } from '@/lib/service-graph/focus';

export const metadata: Metadata = { title: 'Service graph' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The dependency map: business services, technical services and how they depend on each other,
 * with live health. Focus mode (`?focus=bs:<id>` or `svc:<id>`) shows two hops around one node.
 */
export default async function ServiceGraphPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
}) {
  await requirePageAccess('/services/graph');
  const [actor, raw] = await Promise.all([getCurrentAuthorizationActor(), searchParams]);
  const focus = parseGraphFocus(first(raw?.focus));
  const [graph, teams] = await Promise.all([
    getServiceGraphForActor(actor, prisma, { focus, access: 'service' }),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ]);
  const canEdit = hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE);
  const focusName = !graph
    ? null
    : focus?.kind === 'bs'
      ? (graph.businessServices.find(bs => bs.id === focus.id)?.name ?? null)
      : focus
        ? (graph.nodes.find(node => node.id === focus.id)?.name ?? null)
        : null;
  const impacted = graph
    ? [...graph.nodes, ...graph.businessServices].filter(
        node => node.status !== 'OPERATIONAL' && node.status !== 'UNKNOWN'
      ).length
    : 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8">
      <PageHeader
        eyebrow="Infrastructure Directory"
        title="Service graph"
        description="How business services and technical services depend on each other, with live health."
        icon={Network}
        breadcrumbs={[
          { label: 'Services', href: '/services' },
          ...(focusName
            ? [{ label: 'Service graph', href: '/services/graph' }, { label: focusName }]
            : [{ label: 'Service graph' }]),
        ]}
        stats={
          graph
            ? [
                {
                  label: 'Business services',
                  value: graph.businessServices.length,
                  icon: <Boxes className="h-3.5 w-3.5" />,
                },
                {
                  label: 'Technical services',
                  value: graph.nodes.length,
                  icon: <Server className="h-3.5 w-3.5" />,
                },
                { label: 'Dependencies', value: graph.edges.length },
                {
                  label: 'Impacted now',
                  value: impacted,
                  icon: <TriangleAlert className="h-3.5 w-3.5" />,
                },
              ]
            : undefined
        }
      />
      {!graph ? (
        <EmptyState
          variant="card"
          title="The service graph is not available to you"
          description="Ask an administrator for access to the services you work on."
        />
      ) : graph.nodes.length === 0 && graph.businessServices.length === 0 && !focus ? (
        <EmptyState
          variant="card"
          icon={<Network className="h-6 w-6" aria-hidden="true" />}
          title="No services to map yet"
          description="Services you can access, and the dependencies between them, appear here."
          primaryAction={
            <Link className="underline" href="/services">
              Go to services
            </Link>
          }
        />
      ) : (
        <ServiceGraphExplorer
          graph={graph}
          teams={teams}
          canEdit={canEdit}
          focusName={focusName}
          initial={{
            q: first(raw?.q) ?? '',
            team: first(raw?.team) ?? '',
            impacted: first(raw?.impacted) === '1',
            view: first(raw?.view) === 'list' ? 'list' : 'graph',
          }}
        />
      )}
    </div>
  );
}
