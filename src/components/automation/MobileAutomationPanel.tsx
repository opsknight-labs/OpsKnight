import Link from 'next/link';
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
    <section aria-label="Automation status" className="rounded-xl border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Automation</h2>
        <span className="text-xs text-muted-foreground">
          {mode} · v{version ?? '—'}
        </span>
      </div>
      <Link
        className="inline-flex min-h-11 items-center text-sm font-semibold underline"
        href={`/m/services/${serviceId}/automation`}
      >
        View automation →
      </Link>
    </section>
  );
}
