'use client';

import type { ComponentProps } from 'react';
import StatusPageConfig from '@/components/StatusPageConfig';

type StatusPageWorkspaceProps = ComponentProps<typeof StatusPageConfig>;

/**
 * The Status Page has one settings workspace. Design is an ordinary settings section beside
 * General, Appearance, Services, Privacy, and the other sections, so it shares the same draft,
 * preview, save, publication-state, and optimistic-concurrency flow.
 */
export default function StatusPageWorkspace(props: StatusPageWorkspaceProps) {
  return <StatusPageConfig {...props} />;
}
