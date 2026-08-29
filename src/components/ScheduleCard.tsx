import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Clock, Layers, Users, Calendar, ArrowRight } from 'lucide-react';

type ScheduleCardProps = {
  schedule: {
    id: string;
    name: string;
    timeZone: string;
    layers: Array<{
      users: Array<{
        userId: string;
        user?: {
          name: string;
          avatarUrl?: string | null;
          gender?: string | null;
        } | null;
      }>;
    }>;
  };
  index?: number;
};

export default function ScheduleCard({ schedule }: ScheduleCardProps) {
  const uniqueUsersMap = new Map<
    string,
    { name: string; avatarUrl?: string | null; gender?: string | null }
  >();

  schedule.layers.forEach(layer => {
    layer.users.forEach(u => {
      if (!uniqueUsersMap.has(u.userId)) {
        uniqueUsersMap.set(u.userId, {
          name: u.user?.name || 'Responder',
          avatarUrl: u.user?.avatarUrl,
          gender: u.user?.gender,
        });
      }
    });
  });

  const uniqueUsers = Array.from(uniqueUsersMap.entries()).map(([userId, user]) => ({
    userId,
    ...user,
  }));

  const hasLayers = schedule.layers.length > 0;
  const hasResponders = uniqueUsers.length > 0;

  return (
    <Link href={`/schedules/${schedule.id}`} className="group block focus-visible:outline-none">
      <Card className="h-full border-border/70 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary/15 transition-colors">
                <Calendar className="h-4 w-4" />
              </div>
              <CardTitle className="truncate text-base font-semibold transition-colors group-hover:text-primary">
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
              <div className="flex items-center gap-1.5 text-xs">
                <Layers className="h-3.5 w-3.5" />
                <span>
                  {schedule.layers.length} {schedule.layers.length === 1 ? 'layer' : 'layers'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-xs">
                <Users className="h-3.5 w-3.5" />
                <span>
                  {uniqueUsers.length} {uniqueUsers.length === 1 ? 'responder' : 'responders'}
                </span>
              </div>
            </div>

            {/* Responder avatar stack or status */}
            {uniqueUsers.length > 0 ? (
              <div className="flex items-center -space-x-1.5 overflow-hidden">
                {uniqueUsers.slice(0, 3).map(u => (
                  <DirectUserAvatar
                    key={u.userId}
                    avatarUrl={u.avatarUrl || getDefaultAvatar(u.gender, u.userId || u.name)}
                    name={u.name}
                    size="xs"
                    className="h-5 w-5 ring-1.5 ring-background"
                  />
                ))}
                {uniqueUsers.length > 3 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-1.5 ring-background">
                    +{uniqueUsers.length - 3}
                  </span>
                )}
              </div>
            ) : (
              <Badge variant="warning" size="xs">
                Needs setup
              </Badge>
            )}
          </div>

          {/* Status indicator for incomplete schedules */}
          {(!hasLayers || !hasResponders) && hasResponders && (
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
