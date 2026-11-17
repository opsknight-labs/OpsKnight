import { TeamLeadMarker } from './TeamRoleBadge';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';

type TeamLeadBadgeProps = {
  lead?: {
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string | null;
    gender?: string | null;
  } | null;
  className?: string;
  size?: 'sm' | 'md';
};

export default function TeamLeadBadge({ lead, className, size = 'sm' }: TeamLeadBadgeProps) {
  if (!lead) {
    return (
      <Badge
        variant="outline"
        size="xs"
        className={cn(
          'shrink-0 border-dashed bg-muted/20 text-2xs font-medium text-muted-foreground',
          className
        )}
      >
        No lead
      </Badge>
    );
  }

  const isSmall = size === 'sm';
  const avatarUrl = lead.avatarUrl || getDefaultAvatar(lead.gender, lead.id || lead.name);

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/30 py-0.5 pl-0.5 pr-2 shrink-0 shadow-2xs',
        'text-xs',
        className
      )}
    >
      <DirectUserAvatar
        avatarUrl={avatarUrl}
        name={lead.name}
        size="xs"
        className={cn(isSmall ? 'h-5 w-5' : 'h-6 w-6', 'shrink-0 ring-1 ring-border')}
      />
      <span className="font-semibold text-foreground truncate max-w-[100px] sm:max-w-[130px]">
        {lead.name}
      </span>
      <TeamLeadMarker />
    </div>
  );
}
