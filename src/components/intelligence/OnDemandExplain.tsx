'use client';

import { useId, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import type { OnDemandDetail } from '@/lib/intelligence/helpers/on-demand';

/**
 * A button that asks one on-demand helper and shows its answer below: the plain-language phrasing when an AI
 * provider wrote one, and the deterministic text always. Nothing is requested until a person clicks.
 */
export default function OnDemandExplain({
  label,
  load,
}: {
  label: string;
  /** A server action, already bound to its subject. */
  load: () => Promise<OnDemandDetail | null>;
}) {
  const panelId = useId();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [answer, setAnswer] = useState<OnDemandDetail | null>(null);

  const ask = () => {
    if (state === 'loading') return;
    setState('loading');
    load()
      .then(setAnswer)
      .catch(() => setAnswer(null))
      .finally(() => setState('done'));
  };

  return (
    <div className="space-y-2 text-xs" data-testid="on-demand-explain">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 gap-1.5"
        aria-controls={panelId}
        aria-expanded={state !== 'idle'}
        disabled={state === 'loading'}
        onClick={ask}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Button>
      {state !== 'idle' && (
        <div
          id={panelId}
          aria-live="polite"
          className="space-y-1 rounded-lg border bg-muted/30 p-3 text-muted-foreground"
        >
          {state === 'loading' && <p>Working it out…</p>}
          {state === 'done' && !answer && <p>Nothing more to add right now.</p>}
          {answer?.phrasing && <p className="text-foreground">{answer.phrasing}</p>}
          {answer && <p>{answer.detail}</p>}
        </div>
      )}
    </div>
  );
}
