'use client';

import Button from '@/components/ui/Button';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global Error caught:', error);
  }, [error]);

  return (
    <html>
      <body className="flex min-h-screen flex-col items-center justify-center text-center">
        <h2 className="text-2xl font-extrabold tracking-tight mb-4">Something went wrong!</h2>
        <p className="mb-8 text-neutral-500 max-w-md">
          A critical error occurred in the application.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </body>
    </html>
  );
}
