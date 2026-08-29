import { Crown, UserCheck } from 'lucide-react';
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
          'text-[10px] font-medium text-muted-foreground/80 border-dashed bg-muted/20',
          className
        )}
      >
        No lead assigned
      </Badge>
    );
  }

  const isSmall = size === 'sm';

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/30 py-0.5 pl-0.5 pr-2',
        isSmall ? 'text-[11px]' : 'text-xs',
        className
      )}
    >
      <DirectUserAvatar
        avatarUrl={lead.avatarUrl || getDefaultAvatar(lead.gender, lead.id || lead.name)}
        name={lead.name}
        size="xs"
        className={cn(isSmall ? 'h-4.5 w-4.5' : 'h-5.5 w-5.5', 'shrink-0 ring-1 ring-primary/20')}
      />
      <span className="font-semibold text-foreground truncate max-w-[120px]">{lead.name}</span>
      <span className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1 py-0.2 rounded ring-1 ring-inset ring-primary/20">
        <Crown className="h-2.5 w-2.5 shrink-0" />
        Lead
      </span>
    </div>
  );
}
