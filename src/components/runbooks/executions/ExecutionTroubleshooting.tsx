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
      className="my-2 rounded-lg border bg-muted/20 p-3 text-xs"
    >
      <p className="font-semibold">
        {guidance.title} · {guidance.category}
      </p>
      <p className="mt-1 text-muted-foreground">{guidance.action}</p>
    </aside>
  );
}
