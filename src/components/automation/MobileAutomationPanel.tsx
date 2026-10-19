import Link from 'next/link';
import { ChevronRight, Workflow } from 'lucide-react';
import { ModeBadge, modePresentation } from './workspace/status';

export default function MobileAutomationPanel({
  serviceId,
  mode,
  version,
}: {
  serviceId: string;
  mode: string;
  version: number | null;
}) {
  return (
    <section
      aria-label="Automation status"
      className="space-y-2 rounded-xl border bg-card p-3 text-card-foreground shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Workflow className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Automation
        </h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ModeBadge mode={mode} />
          <span>v{version ?? '—'}</span>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{modePresentation(mode).summary}</p>
      <Link
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={`/m/services/${serviceId}/automation`}
      >
        View automation
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}
