import Link from 'next/link';
import { ArrowRight, Server } from 'lucide-react';

/** Cross-link from a workspace integration to the per-service integrations that route alerts. */
export function ServiceIntegrationsLink({
  title = 'Per-service routing',
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between md:px-6"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Server className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Link
        href="/services"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Go to services
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
