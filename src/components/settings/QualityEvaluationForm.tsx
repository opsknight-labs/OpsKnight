'use client';
import { useActionState } from 'react';
import { measureQualityAction } from '@/app/(app)/settings/intelligence/quality/actions';
import { Button } from '@/components/ui/shadcn/button';

export default function QualityEvaluationForm({ serviceId }: { serviceId: string }) {
  const [state, action, pending] = useActionState(measureQualityAction, { ok: false, message: '' });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="serviceId" value={serviceId} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="kind" value="SHADOW" variant="outline" disabled={pending}>
          Measure shadow quality
        </Button>
        <Button type="submit" name="kind" value="CERTIFICATION" disabled={pending}>
          Evaluate service certification
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          Comparing recorded decisions with human reviews…
        </p>
      )}
      {state.message && (
        <p role={state.ok ? 'status' : 'alert'} className="text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}
