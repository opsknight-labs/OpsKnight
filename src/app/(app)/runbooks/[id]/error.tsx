'use client';

import { RunbookRouteError } from '@/components/runbooks/RunbookRouteError';

export default function RunbookDetailError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RunbookRouteError {...props} title="This runbook couldn't load" />;
}
