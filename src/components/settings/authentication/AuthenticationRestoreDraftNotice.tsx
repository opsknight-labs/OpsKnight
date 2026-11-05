'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { useAuthenticationWorkspace } from './useAuthenticationController';

/** Offers back unsaved changes from earlier in this tab, for example after an accidental reload. */
export default function AuthenticationRestoreDraftNotice() {
  const { restorableDraft, restoreDraft, dismissRestorableDraft } = useAuthenticationWorkspace();
  // Measured once when the notice appears; it does not need to tick.
  const [shownAt] = useState(() => Date.now());
  if (!restorableDraft) return null;
  const minutes = Math.max(1, Math.round((shownAt - restorableDraft.savedAt) / 60_000));
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs"
    >
      <History className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        You have unsaved changes from {minutes} minute{minutes === 1 ? '' : 's'} ago. Restore them?
        Re-enter the client secret if you had changed it.
      </span>
      <span className="flex gap-2">
        <Button size="sm" onClick={restoreDraft}>
          Restore
        </Button>
        <Button size="sm" variant="ghost" onClick={dismissRestorableDraft}>
          Discard
        </Button>
      </span>
    </div>
  );
}
