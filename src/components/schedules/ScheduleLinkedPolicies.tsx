import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { ShieldCheck, Server, ArrowUpRight, Link2, Info } from 'lucide-react';

type LinkedPolicy = {
  stepOrder: number;
  policy: {
    id: string;
    name: string;
    services: Array<{
      id: string;
      name: string;
    }>;
  };
};

type ScheduleLinkedPoliciesProps = {
  linkedRules: LinkedPolicy[];
  scheduleId: string;
};

export default function ScheduleLinkedPolicies({
  linkedRules,
  scheduleId,
}: ScheduleLinkedPoliciesProps) {
  // Deduplicate by policy ID
  const uniquePoliciesMap = new Map<string, LinkedPolicy['policy']>();
  linkedRules.forEach(rule => {
    if (rule.policy && !uniquePoliciesMap.has(rule.policy.id)) {
      uniquePoliciesMap.set(rule.policy.id, rule.policy);
    }
  });

  const policies = Array.from(uniquePoliciesMap.values());
  const allServices = Array.from(
    new Map(policies.flatMap(p => p.services).map(s => [s.id, s])).values()
  );

  return (
    <Card className="overflow-hidden border-border/70 shadow-xs">
      <CardHeader className="border-b bg-muted/20 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Link2 className="h-3.5 w-3.5" />
            </div>
            <div>
              <CardTitle className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Linked Policies &amp; Services
              </CardTitle>
            </div>
          </div>
          <Badge variant="outline" size="xs" className="text-[10px]">
            {policies.length} {policies.length === 1 ? 'policy' : 'policies'} · {allServices.length}{' '}
            {allServices.length === 1 ? 'service' : 'services'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-3.5 sm:p-4">
        {policies.length === 0 ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/70" />
            <div>
              <p className="font-medium text-foreground">No escalation policies attached</p>
              <p className="text-[11px] mt-0.5">
                This schedule is not currently receiving incident alerts. To route alerts to this
                schedule, add it as a step in an{' '}
                <Link
                  href="/policies"
                  className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                >
                  Escalation Policy
                </Link>
                .
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {policies.map(policy => (
              <div
                key={policy.id}
                className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-2.5 sm:flex-row sm:items-center sm:justify-between text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  <Link
                    href={`/policies/${policy.id}`}
                    className="font-semibold text-foreground hover:text-primary transition-colors flex items-center gap-1 truncate"
                  >
                    <span>{policy.name}</span>
                    <ArrowUpRight className="h-3 w-3 opacity-60" />
                  </Link>
                </div>

                {/* Services attached to this policy */}
                {policy.services.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Server className="h-3 w-3 text-muted-foreground/70" />
                      Services:
                    </span>
                    {policy.services.map(service => (
                      <Link
                        key={service.id}
                        href={`/services/${service.id}`}
                        className="rounded-md border bg-background/80 px-2 py-0.5 text-[10px] font-medium text-foreground hover:border-primary/50 transition-colors"
                      >
                        {service.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
