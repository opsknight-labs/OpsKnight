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
      </div>
    </aside>
  );
}
