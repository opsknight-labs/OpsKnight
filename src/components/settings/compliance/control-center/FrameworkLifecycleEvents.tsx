import React from 'react';
import { Layers, Calendar } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';

export interface FrameworkLifecycleEventItem {
  readonly id: string;
  readonly framework: string;
  readonly requirementId: string;
  readonly summary: string;
  readonly details: {
    readonly previousLifecycle?: string;
    readonly currentLifecycle?: string;
    readonly title?: string;
  };
  readonly firstDetectedAt: string;
}

interface FrameworkLifecycleEventsProps {
  readonly events: readonly FrameworkLifecycleEventItem[];
}

export function FrameworkLifecycleEvents({ events }: FrameworkLifecycleEventsProps) {
  if (events.length === 0) return null;

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-500" />
          Recent Framework Lifecycle Milestones
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Informational legal and statutory lifecycle changes (e.g. staged commencement or
          supersedence), independent of technical runtime evaluations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2.5">
          {events.map(ev => (
            <div
              key={ev.id}
              className="flex items-center justify-between p-2.5 rounded-md border border-border bg-muted/20 text-xs"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    {ev.framework}
                  </Badge>
                  <span className="font-medium text-foreground">{ev.requirementId}</span>
                  {ev.details?.title && (
                    <span className="text-muted-foreground truncate max-w-xs">
                      {ev.details.title}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {ev.details?.previousLifecycle && ev.details?.currentLifecycle ? (
                    <span>
                      Transitioned from{' '}
                      <span className="font-semibold text-foreground">
                        {ev.details.previousLifecycle}
                      </span>{' '}
                      to{' '}
                      <span className="font-semibold text-primary">
                        {ev.details.currentLifecycle}
                      </span>
                    </span>
                  ) : (
                    ev.summary
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Calendar className="h-3 w-3" />
                {new Date(ev.firstDetectedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
