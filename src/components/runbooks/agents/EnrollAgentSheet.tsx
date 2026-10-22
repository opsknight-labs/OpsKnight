import type { ComponentProps } from 'react';
import type { AgentDistribution } from '@/lib/runbooks/distribution-contract';
import AgentEnrollmentForm from '@/components/runbooks/AgentEnrollmentForm';
import { ConfigureSheet } from '@/components/runbooks/RunbookControls';
import { Button } from '@/components/ui/shadcn/button';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EnrollAgentSheet({
  label,
  userTimeZone,
  appUrl,
  distribution,
  variant,
  className,
}: {
  label: string;
  userTimeZone: string;
  appUrl?: string;
  distribution?: AgentDistribution | null;
  variant?: ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  return (
    <ConfigureSheet
      title="Enroll an Agent"
      description="Single-use enrollment tokens expire after 15 minutes. The private key never leaves the Agent."
      trigger={
        <Button
          variant={variant}
          className={cn(
            !variant && 'gap-1.5 bg-white text-zinc-950 hover:bg-zinc-100 font-semibold shadow-xs',
            className
          )}
        >
          {!variant && <Plus className="h-4 w-4" />}
          <span>{label}</span>
        </Button>
      }
    >
      <AgentEnrollmentForm
        userTimeZone={userTimeZone}
        appUrl={appUrl}
        distribution={distribution}
      />
    </ConfigureSheet>
  );
}
