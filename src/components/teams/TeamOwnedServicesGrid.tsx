import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Shield, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { cn } from '@/lib/utils';

type ServiceItem = {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
};

type TeamOwnedServicesGridProps = {
  services: ServiceItem[];
  teamId?: string;
  canManage?: boolean;
  compact?: boolean;
  className?: string;
};

export default function TeamOwnedServicesGrid({
  services,
  teamId: _teamId,
  canManage = false,
  compact = false,
  className,
}: TeamOwnedServicesGridProps) {
  if (services.length === 0) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
          <Shield className="h-3 w-3" /> No services
        </span>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 px-4 text-center">
        <Shield className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-xs font-semibold text-foreground">No services assigned to this team</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 max-w-sm">
          Services assigned to this team will inherit this team&apos;s members and escalation
          routing.
        </p>
        {canManage && (
          <Button asChild size="sm" variant="outline" className="mt-3 h-7 text-xs gap-1.5">
            <Link href="/services">
              <Plus className="h-3.5 w-3.5" />
              Assign Services
            </Link>
          </Button>
        )}
      </div>
    );
  }

  if (compact) {
    const maxVisible = 2;
    const visibleServices = services.slice(0, maxVisible);
    const remainingCount = services.length - maxVisible;

    return (
      <div className={cn('flex items-center gap-1.5 flex-wrap justify-end', className)}>
        {visibleServices.map(service => (
          <Link
            key={service.id}
            href={`/services/${service.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground hover:border-primary/50 hover:bg-muted/80 transition-colors shadow-2xs group"
          >
            <Shield className="h-2.5 w-2.5 text-primary/70 group-hover:text-primary shrink-0" />
            <span className="truncate max-w-[95px]">{service.name}</span>
          </Link>
        ))}
        {remainingCount > 0 && (
          <Badge
            variant="secondary"
            size="xs"
            className="text-[10px] px-1.5 py-0.5 font-medium shrink-0"
          >
            +{remainingCount}
          </Badge>
        )}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3', className)}>
      {services.map(service => (
        <Link key={service.id} href={`/services/${service.id}`} className="group">
          <Card className="overflow-hidden border-border/70 shadow-2xs hover:border-primary/40 hover:shadow-xs transition-all">
            <CardContent className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <Shield className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-xs text-foreground truncate group-hover:text-primary transition-colors">
                    {service.name}
                  </p>
                  {service.description && (
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                      {service.description}
                    </p>
                  )}
                </div>
              </div>

              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-primary transition-colors shrink-0" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
