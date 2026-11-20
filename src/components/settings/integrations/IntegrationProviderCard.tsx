import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { IntegrationStatusBadge, type IntegrationState } from './IntegrationStatus';

/** One provider on the integrations hub: logo, name, purpose, state; the whole card is one link. */
export function IntegrationProviderCard({
  href,
  name,
  description,
  logo,
  state,
  stateLabel,
}: {
  href: string;
  name: string;
  description: string;
  logo: ReactNode;
  state: IntegrationState;
  stateLabel?: string;
}) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:border-ink-300 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground [&_svg]:h-5 [&_svg]:w-5">
          {logo}
        </div>
        <IntegrationStatusBadge state={state} label={stateLabel} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="text-base font-semibold text-foreground">{name}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground">
        {state === 'connected' ? 'Manage' : state === 'error' ? 'Check settings' : 'Set up'}
        <ChevronRight
          className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}
