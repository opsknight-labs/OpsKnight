import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Cpu, Wrench, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SharedResponsibilityCardProps {
  readonly operatorResponsibility?: string | null;
  readonly organizationalResponsibility?: string | null;
  readonly productScope?: string | null;
  readonly className?: string;
  readonly compact?: boolean;
}

export function SharedResponsibilityCard({
  operatorResponsibility,
  organizationalResponsibility,
  productScope,
  className,
  compact = false,
}: SharedResponsibilityCardProps) {
  return (
    <Card className={cn('border-border/60 bg-muted/20 shadow-none', className)}>
      <CardHeader className={compact ? 'p-3 pb-2' : 'p-4 pb-2'}>
        <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Shared Responsibility Model
        </CardTitle>
      </CardHeader>
      <CardContent className={compact ? 'p-3 pt-0 space-y-2' : 'p-4 pt-0 space-y-3'}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
          {/* Platform / Product */}
          <div className="p-2.5 rounded-lg border border-border/50 bg-background/60 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Cpu className="h-3.5 w-3.5 text-sky-500" />
              <span>OpsKnight Platform</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {productScope ||
                'Provides runtime control evaluation, verifiable evidence generation, and audit logging.'}
            </p>
          </div>

          {/* Operator / Engineering */}
          <div className="p-2.5 rounded-lg border border-border/50 bg-background/60 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Wrench className="h-3.5 w-3.5 text-amber-500" />
              <span>Operator & Infra</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {operatorResponsibility ||
                'Maintains KMS key rings, env secrets, TLS endpoints, and operational deployment hygiene.'}
            </p>
          </div>

          {/* Organization / Legal */}
          <div className="p-2.5 rounded-lg border border-border/50 bg-background/60 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Building2 className="h-3.5 w-3.5 text-purple-500" />
              <span>Organization & Legal</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {organizationalResponsibility ||
                'Executes privacy policies, DPA agreements, RoPA governance, and external auditor signoffs.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
