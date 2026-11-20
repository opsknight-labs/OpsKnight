import type { ReactNode } from 'react';
import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';

/** Calm, branded full-page notice: what happened, a primary action, a secondary action, request id. */
export default function ErrorPageShell({
  code,
  title,
  message,
  requestId,
  icon,
}: {
  code?: string;
  title: string;
  message: ReactNode;
  requestId?: string | null;
  icon?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground [&>svg]:h-8 [&>svg]:w-8"
        >
          {icon ?? <SearchX />}
        </div>
        {code ? <p className="mb-1 font-mono text-sm text-muted-foreground">{code}</p> : null}
        <h1 className="mb-2 font-display text-2xl font-extrabold tracking-tight">{title}</h1>
        <p className="mb-6 text-base leading-relaxed text-muted-foreground">{message}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link href="/">Go to dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/help">Help and support</Link>
          </Button>
        </div>
        {requestId ? (
          <p className="mt-6 text-xs text-muted-foreground">
            Request ID: <span className="select-all font-mono">{requestId}</span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
