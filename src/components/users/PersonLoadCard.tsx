import Link from 'next/link';
import { Activity, Moon, Wrench } from 'lucide-react';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { loadPersonProfileInsights } from '@/lib/intelligence/people/profile';
import InsightsPanel from '@/components/intelligence/insights/InsightsPanel';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

/**
 * Load and expertise on a person's profile: pages and night pages over 28 days, their on-call insights,
 * and the services they resolved incidents on. Self, team lead and admin only; renders nothing otherwise,
 * while "Suggest people" is off, or when there is nothing to show. Never takes the page down.
 */
export default async function PersonLoadCard({
  actor,
  userId,
}: {
  actor: AuthorizationActor | null;
  userId: string;
}) {
  const card = actor
    ? await loadPersonProfileInsights(actor, userId).catch(error => {
        logger.warn('intelligence.person_card.unavailable', { userId, error });
        return null;
      })
    : null;
  if (!actor || !card) return null;
  const { load } = card;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Load and expertise</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid max-w-md grid-cols-2 gap-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              Pages, last {load.windowDays} days
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">{load.pages}</dd>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
              Night pages
            </dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums">
              {load.nightPages}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                on {load.nightsPaged} {load.nightsPaged === 1 ? 'night' : 'nights'}
              </span>
            </dd>
          </div>
        </dl>

        <InsightsPanel
          insights={card.insights}
          canDecide={hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)}
          label="On-call insights"
        />

        {card.expertise.length > 0 && (
          <div>
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              Resolved incidents, last {card.expertiseDays} days
            </h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {card.expertise.map(service => (
                <li key={service.serviceId}>
                  <Link
                    href={`/services/${service.serviceId}`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
                  >
                    <span className="max-w-[16rem] truncate">{service.serviceName}</span>
                    <span className="tabular-nums text-muted-foreground">{service.resolved}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
