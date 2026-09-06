import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Network, ArrowUpRight } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils';

type PolicyItem = {
  id: string;
  name: string;
  description?: string | null;
  repeatCount?: number;
  services?: Array<{ id: string; name: string }>;
  _count?: {
    steps: number;
  };
};

type TeamLinkedPoliciesProps = {
  policies: PolicyItem[];
  className?: string;
};

export default function TeamLinkedPolicies({ policies, className }: TeamLinkedPoliciesProps) {
  if (policies.length === 0) {
    return (
      <EmptyState
        icon={<Network className="h-6 w-6 text-muted-foreground/60" />}
        title="No escalation policies attached"
        description="Escalation policies attached to this team's services will route incidents to these members."
        className={className}
      />
    );
  }

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 gap-3', className)}>
      {policies.map(policy => (
        <Link key={policy.id} href={`/policies/${policy.id}`} className="group">
          <Card className="overflow-hidden border-border/70 shadow-2xs hover:border-primary/40 hover:shadow-xs transition-all">
            <CardContent className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Network className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-xs text-foreground truncate group-hover:text-primary transition-colors">
                    {policy.name}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                    {policy._count?.steps !== undefined && (
                      <span>{policy._count.steps} escalation steps</span>
                    )}
                    {policy.services && policy.services.length > 0 && (
                      <span>· {policy.services.length} services</span>
                    )}
                  </div>
                </div>
              </div>

              <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
