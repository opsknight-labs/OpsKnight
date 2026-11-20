import { Crown } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
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
          'text-2xs font-medium text-muted-foreground/70 border-dashed bg-muted/20 shrink-0',
          className
        )}
      >
        No lead
      </Badge>
    );
  }

  const isSmall = size === 'sm';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/30 py-0.5 pl-0.5 pr-2 shrink-0 shadow-2xs',
        isSmall ? 'text-2xs' : 'text-xs',
        className
      )}
    >
      <UserAvatar
        userId={lead.id}
        avatarUrl={lead.avatarUrl}
        name={lead.name}
        gender={lead.gender}
        size="xs"
        aria-hidden
        className={cn(isSmall ? 'h-5 w-5' : 'h-6 w-6', 'ring-1 ring-primary/20 shrink-0')}
      />
      <span className="font-semibold text-foreground truncate max-w-[100px] sm:max-w-[130px]">
        {lead.name}
      </span>
      <span className="flex items-center gap-0.5 text-2xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-1 py-0.2 rounded ring-1 ring-inset ring-primary/20 shrink-0">
        <Crown className="h-2.5 w-2.5" />
        Lead
      </span>
    </div>
  );
}
