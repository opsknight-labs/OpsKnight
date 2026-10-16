import { Lightbulb } from 'lucide-react';
import { runbookTroubleshooting } from '@/lib/runbooks/presentation/troubleshooting';

export default function ExecutionTroubleshooting({
  status,
  code,
}: {
  status: string;
  code?: string | null;
}) {
  const guidance = runbookTroubleshooting(status, code);
  if (!guidance) return null;
  return (
    <aside
      aria-label="Troubleshooting guidance"
      className="flex items-start gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs"
    >
      <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold text-foreground">
          {guidance.title} · {guidance.category}
        </p>
        <p className="mt-0.5 leading-relaxed text-muted-foreground">{guidance.action}</p>
        {(status === 'UNKNOWN' ||
          code === 'UNKNOWN_OUTCOME' ||
          code === 'TIMED_OUT_WITH_UNKNOWN_OUTCOME') && (
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Preserve the execution, attempt, Agent identity and plan digest. Inspect the last
              contact, lease expiry and captured evidence below.
            </li>
            <li>
              Independently check the service, container or Kubernetes target. A missing result does
              not mean the write failed.
            </li>
            <li>
              Record the observed outcome in the incident timeline before authorizing a new
              execution. Do not retry an uncertain write automatically.
            </li>
          </ol>
        )}
      </div>
    </aside>
  );
}
