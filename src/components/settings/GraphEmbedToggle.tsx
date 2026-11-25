'use client';

import { useState, useTransition } from 'react';
import { setGraphEmbedEnabledAction } from '@/app/(app)/services/graph/actions';
import { Switch } from '@/components/ui/shadcn/switch';
import { notify } from '@/lib/toast';

/** Admin switch for read-only, anonymized share links to saved service-graph views. Off by default. */
export default function GraphEmbedToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="space-y-1">
        <label htmlFor="graph-embed-enabled" className="text-sm font-medium">
          Allow read-only share links
        </label>
        <p className="text-sm text-muted-foreground">
          Lets an administrator create a link to a saved service-graph view. Anyone with the link sees an
          anonymized graph (labels, statuses and edges; no names, teams or incidents) until it expires or is
          revoked. Turning this off stops every existing link at once.
        </p>
      </div>
      <Switch
        id="graph-embed-enabled"
        checked={enabled}
        disabled={pending}
        onCheckedChange={next =>
          start(async () => {
            const result = await setGraphEmbedEnabledAction({ enabled: next });
            if (result.ok) setEnabled(next);
            else notify.error(result.message);
          })
        }
      />
    </div>
  );
}
