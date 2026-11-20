'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState } from '@/components/patterns';

/** A failed section shows this in place; the rest of the page keeps working. */
export default function SectionError({ title, errorCode }: { title: string; errorCode?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <ErrorState
      variant="inline"
      title={`${title} couldn't load`}
      message="The rest of the page is unaffected. Try again in a moment."
      errorCode={errorCode}
      onRetry={() => startTransition(() => router.refresh())}
      isRetrying={isPending}
    />
  );
}
