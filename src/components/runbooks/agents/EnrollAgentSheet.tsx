import type { ComponentProps } from 'react';
import type { AgentDistribution } from '@/lib/runbooks/distribution-contract';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import { ConfigureSheet } from '@/components/runbooks/RunbookControls';
import { Button } from '@/components/ui/shadcn/button';

export function EnrollAgentSheet({
  label,
  userTimeZone,
  appUrl,
  distribution,
  variant,
}: {
  label: string;
  userTimeZone: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
  variant?: ComponentProps<typeof Button>['variant'];
}) {
  return (
    <ConfigureSheet
      title="Enroll an Agent"
      description="Single-use enrollment tokens expire after 15 minutes. The private key never leaves the Agent."
      trigger={<Button variant={variant}>{label}</Button>}
    >
      <AgentEnrollmentForm
        userTimeZone={userTimeZone}
        appUrl={appUrl}
        distribution={distribution}
      />
    </ConfigureSheet>
  );
}
