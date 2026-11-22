import type { ReactNode } from 'react';
import { Hourglass } from 'lucide-react';
import { EmptyState } from '@/components/patterns';

/**
 * Calm placeholder while the health engine is not live yet: nothing is broken, the data just is not
 * computed. Shown in place of status, KPIs and boards.
 */
export default function HealthPreparing({
  description = 'Live status, impact history and uptime appear here as soon as health is computed. Owners, services and followers are ready now.',
  action,
  size = 'md',
}: {
  description?: string;
  action?: ReactNode;
  size?: 'sm' | 'md';
}) {
  return (
    <EmptyState
      variant="card"
      size={size}
      icon={<Hourglass className="h-6 w-6" aria-hidden />}
      title="Health is being prepared"
      description={description}
      action={action}
    />
  );
}
