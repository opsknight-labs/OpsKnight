import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { formatDateTime } from '@/lib/timezone';
import { Activity, UserPlus, UserMinus, ShieldAlert, Edit, Sparkles } from 'lucide-react';

type AuditLogItem = {
  id: string;
  action: string;
  actorName?: string | null;
  actorEmail?: string | null;
  details?: any;
  createdAt: Date | string;
  actor?: {
    id: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
};

type TeamActivityTimelineProps = {
  logs: AuditLogItem[];
  emptyMessage?: string;
};

function formatActionTitle(action: string): {
  label: string;
  icon: any;
  variant: 'default' | 'secondary' | 'warning' | 'destructive' | 'info' | 'success';
} {
  switch (action) {
    case 'team.created':
      return { label: 'Team Created', icon: Sparkles, variant: 'success' };
    case 'team.updated':
      return { label: 'Team Details Updated', icon: Edit, variant: 'secondary' };
    case 'team.deleted':
      return { label: 'Team Deleted', icon: ShieldAlert, variant: 'destructive' };
    case 'team.member_added':
      return { label: 'Member Added', icon: UserPlus, variant: 'info' };
    case 'team.member_removed':
      return { label: 'Member Removed', icon: UserMinus, variant: 'warning' };
    case 'team.member_role_updated':
      return { label: 'Role Changed', icon: Edit, variant: 'secondary' };
    default:
      return {
        label: action
          .replace(/^team\./, '')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase()),
        icon: Activity,
        variant: 'secondary',
      };
  }
}

export default function TeamActivityTimeline({
  logs,
  emptyMessage = 'No recent activity recorded for this team.',
}: TeamActivityTimelineProps) {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-8 text-center">
        <Activity className="h-8 w-8 text-muted-foreground/40 mb-2" />
        <p className="text-xs font-semibold text-foreground">No recent activity</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-3 pl-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border/60">
      {logs.map(log => {
        const { label, icon: Icon, variant } = formatActionTitle(log.action);
        const actorName = log.actor?.name || log.actorName || 'System';
        const actorAvatar =
          log.actor?.avatarUrl || getDefaultAvatar(log.actor?.gender, log.actor?.id || actorName);

        const details =
          typeof log.details === 'object' && log.details !== null
            ? log.details
            : typeof log.details === 'string'
              ? (() => {
                  try {
                    return JSON.parse(log.details);
                  } catch {
                    return { text: log.details };
                  }
                })()
              : {};

        return (
          <div key={log.id} className="relative flex items-start gap-3 text-xs">
            {/* Dot marker */}
            <div className="absolute -left-4 mt-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary ring-2 ring-primary/20" />

            <div className="flex-1 rounded-lg border border-border/70 bg-card p-3 shadow-2xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={variant} size="xs" className="gap-1 text-[10px] py-0 px-1.5">
                    <Icon className="h-2.5 w-2.5" />
                    {label}
                  </Badge>
                </div>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatDateTime(new Date(log.createdAt), 'UTC', { format: 'relative' })}
                </span>
              </div>

              {/* Actor & details */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <DirectUserAvatar
                  avatarUrl={actorAvatar}
                  name={actorName}
                  size="xs"
                  className="h-4 w-4 shrink-0"
                />
                <span className="font-medium text-foreground">{actorName}</span>
                {details.name && (
                  <span>
                    team: <strong className="text-foreground font-semibold">{details.name}</strong>
                  </span>
                )}
                {details.role && (
                  <span>
                    role: <strong className="text-foreground font-semibold">{details.role}</strong>
                  </span>
                )}
                {details.userName && (
                  <span>
                    user:{' '}
                    <strong className="text-foreground font-semibold">{details.userName}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
