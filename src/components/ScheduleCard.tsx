import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { Clock, Layers, Users, ArrowRight, Calendar } from 'lucide-react';

type ScheduleCardProps = {
  schedule: {
    id: string;
    name: string;
    timeZone: string;
    layers: Array<{
      users: Array<{
        userId: string;
      }>;
    }>;
  };
  index?: number;
};

export default function ScheduleCard({ schedule }: ScheduleCardProps) {
  const uniqueUsers = new Set<string>();
  schedule.layers.forEach(layer => {
    layer.users.forEach(user => uniqueUsers.add(user.userId));
  });

  const hasLayers = schedule.layers.length > 0;
  const hasResponders = uniqueUsers.size > 0;

  return (
    <Link href={`/schedules/${schedule.id}`} className="block group">
      <Card className="border-border/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <Calendar className="h-4 w-4" />
              </div>
              <CardTitle className="text-base font-semibold transition-colors group-hover:text-primary">
                {schedule.name}
              </CardTitle>
            </div>
            <Badge variant="outline" size="xs" className="gap-1.5 shrink-0">
              <Clock className="h-3 w-3 text-muted-foreground" />
              {schedule.timeZone}
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4" />
                <span>
                  {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                <span>
                  {uniqueUsers.size} {uniqueUsers.size === 1 ? 'responder' : 'responders'}
                </span>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200 text-primary" />
          </div>

          {/* Status indicator for incomplete schedules */}
          {(!hasLayers || !hasResponders) && (
            <div className="mt-3 border-t pt-3">
              <Badge variant="warning" size="xs">
                Needs configuration
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
