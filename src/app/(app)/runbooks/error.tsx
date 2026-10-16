'use client';

import { RunbookRouteError } from '@/components/runbooks/RunbookRouteError';

export default function RunbooksError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RunbookRouteError {...props} title="Runbooks couldn't load" backHref="/" backLabel="Go home" />;
}
