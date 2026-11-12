'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';

import type { AccessExplanation } from '@/lib/access/server';
import AccessDeniedView from '@/components/access/AccessDeniedView';

/**
 * Next renders boundary files with every page, so the 403 boundary must stay cheap: it fetches
 * the explanation for the current path only when the Access denied page is actually shown.
 */
export default function AccessDeniedLoader({ variant = 'page' }: { variant?: 'page' | 'mobile' }) {
  const [explanation, setExplanation] = useState<AccessExplanation | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const path = `${window.location.pathname}${window.location.search}`;
    fetch(`/api/access/explain?path=${encodeURIComponent(path)}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async response => {
        const body = (await response.json()) as { success?: boolean; data?: AccessExplanation };
        if (!response.ok || !body.success || !body.data) throw new Error('unavailable');
        setExplanation(body.data);
      })
      .catch(error => {
        if ((error as Error).name !== 'AbortError') setFailed(true);
      });
    return () => controller.abort();
  }, []);

  if (explanation) return <AccessDeniedView explanation={explanation} variant={variant} />;

  return (
    <div className="flex w-full justify-center px-4 py-10 sm:py-16">
      <section
        aria-labelledby="access-denied-title"
        aria-busy={!failed}
        className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
            <Lock className="h-5 w-5 text-amber-700 dark:text-amber-300" aria-hidden />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Access denied · 403
            </p>
            <h1 id="access-denied-title" className="text-xl font-semibold text-foreground">
              You don’t have access to this page
            </h1>
            <p className="text-sm text-muted-foreground">
              {failed ? (
                <>
                  Ask an administrator for access, or{' '}
                  <Link href="/settings/access" className="text-primary underline">
                    see what you can access and request more
                  </Link>
                  .
                </>
              ) : (
                'Checking what this page needs…'
              )}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
