'use client';

import { useActionState } from 'react';
import type { IntelligenceActionState } from '@/app/(app)/settings/intelligence/actions';
import { applyRecommendedSetup } from '@/app/(app)/settings/intelligence/setup-actions';
import { Button } from '@/components/ui/shadcn/button';
import type { SetupRevisions } from '@/lib/intelligence/settings/setup-contract';
import { ActionMessage } from '@/components/settings/form-kit';

const initialState: IntelligenceActionState = { message: '', ok: true };

/** Applies the Recommended preset with the revisions the page showed, so a concurrent edit is refused. */
export default function RecommendedPresetButton({
  revisions,
  label = 'Turn on recommended',
  pendingLabel = 'Turning on…',
}: {
  revisions: SetupRevisions;
  label?: string;
  pendingLabel?: string;
}) {
  const [state, action, pending] = useActionState(applyRecommendedSetup, initialState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {Object.entries(revisions).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-10">
        {pending ? pendingLabel : label}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}
