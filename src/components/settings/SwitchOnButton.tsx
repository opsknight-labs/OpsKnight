'use client';

import { useActionState } from 'react';
import type { IntelligenceActionState } from '@/app/(app)/settings/intelligence/actions';
import { switchOnIntelligence } from '@/app/(app)/settings/intelligence/setup-actions';
import { Button } from '@/components/ui/shadcn/button';
import { ActionMessage } from '@/components/settings/form-kit';
import type { SetupRevisions } from '@/lib/intelligence/settings/setup-contract';

const initialState: IntelligenceActionState = { message: '', ok: true };

/** "Switch on", with the revisions the page showed so a concurrent edit is refused. */
export default function SwitchOnButton({
  revisions,
  label,
}: {
  revisions: SetupRevisions;
  label: string;
}) {
  const [state, action, pending] = useActionState(switchOnIntelligence, initialState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {Object.entries(revisions).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" disabled={pending} className="min-h-11 sm:min-h-10">
        {pending ? 'Switching on…' : label}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}
