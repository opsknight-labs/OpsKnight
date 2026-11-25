import { TriangleAlert } from 'lucide-react';
import { freezeForBusinessService } from '@/lib/business-services/reviews/freeze-service';
import { toneClasses } from '@/components/patterns/status-tone';

/** Advisory banner when the error budget is exhausted and an admin enabled freeze warnings. */
export async function FreezeBanner({ id }: { id: string }) {
  const freeze = await freezeForBusinessService(id).catch(() => null);
  if (!freeze?.warn) return null;
  return (
    <div
      role="status"
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${toneClasses('elevated').soft}`}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold">Error budget exhausted.</span> {freeze.message}
      </p>
    </div>
  );
}
