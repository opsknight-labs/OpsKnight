'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Check, X } from 'lucide-react';
import type { OnboardingStep } from '@/lib/onboarding';

const STORAGE_KEY = 'opsknight:get-started-dismissed';

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
const readDismissed = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

/** First-run checklist. Hides itself when every step is done or the user dismisses it. */
export default function GetStartedChecklist({ steps }: { steps: OnboardingStep[] }) {
  // Server snapshot is `true` so a dismissed checklist never flashes before storage is read.
  const storedDismissed = useSyncExternalStore(subscribe, readDismissed, () => true);
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = storedDismissed || dismissedNow;

  const doneCount = steps.filter(s => s.done).length;
  if (dismissed || doneCount === steps.length) return null;

  const dismiss = () => {
    setDismissedNow(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      /* private mode: dismissal lasts for this view only */
    }
  };

  return (
    <section
      aria-labelledby="get-started-title"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 id="get-started-title" className="text-lg font-semibold text-foreground">
            Get started with OpsKnight
          </h2>
          <p className="text-sm text-muted-foreground">
            {doneCount} of {steps.length} steps complete
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss get started checklist"
          className="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ol className="space-y-2">
        {steps.map(step => (
          <li key={step.id}>
            <Link
              href={step.href}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-success text-white'
                    : 'h-5 w-5 shrink-0 rounded-full border border-border'
                }
              >
                {step.done ? <Check className="h-3 w-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  {step.title}
                  {step.done ? <span className="sr-only"> (done)</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{step.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
