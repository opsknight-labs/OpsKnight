'use client';

import { RunbookRouteError } from '@/components/runbooks/RunbookRouteError';

export default function RunbookAgentsError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RunbookRouteError {...props} title="Agent fleet couldn't load" />;
}
