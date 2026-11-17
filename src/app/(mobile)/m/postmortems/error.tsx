'use client';

import { MobileRouteError } from '@/components/mobile/MobileRouteError';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <MobileRouteError error={error} reset={reset} title="Postmortems could not load" />;
}
