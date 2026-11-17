'use client';

import { MobileRouteError } from '@/components/mobile/MobileRouteError';

export default function MobileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MobileRouteError error={error} reset={reset} />;
}
