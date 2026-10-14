'use client';
import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import type { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { Button } from '@/components/ui/shadcn/button';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { ShieldAlert } from 'lucide-react';

function Loading() {
  return (
    <div aria-label="Loading authentication settings" role="status" className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
const Console = dynamic(() => import('./AuthenticationConsole'), { loading: Loading });

export default function AuthenticationSettingsLoader(props: {
  callbackUrl: string;
  testCallbackUrl: string;
  scimSection?: ReactNode;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof authenticationDashboard>> | null>(
    null
  );
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/control', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Unable to load authentication settings.');
        setData(body.data);
      })
      .catch(failure => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Unable to load settings.');
      });
    return () => controller.abort();
  }, [attempt]);
  if (error)
    return (
      <div
        role="alert"
        className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 space-y-3"
      >
        <ShieldAlert className="h-5 w-5 text-destructive" />
        <p>{error}</p>
        <Button
          variant="outline"
          onClick={() => {
            setError('');
            setAttempt(value => value + 1);
          }}
        >
          Retry loading
        </Button>
      </div>
    );
  return data ? <Console initialData={data} {...props} /> : <Loading />;
}
