'use client';

import { RunbookRouteError } from '@/components/runbooks/RunbookRouteError';

export default function RunbookExecutionsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RunbookRouteError
      {...props}
      title="Executions couldn't load"
      backHref="/runbooks/executions"
      backLabel="Back to executions"
    />
  );
}
