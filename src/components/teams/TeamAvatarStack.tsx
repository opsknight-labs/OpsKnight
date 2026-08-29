import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type MemberItem = {
  userId?: string;
  role?: string;
  user: {
    id?: string;
    name: string;
    avatarUrl?: string | null;
    gender?: string | null;
  };
};

type TeamAvatarStackProps = {
  members: MemberItem[];
  maxVisible?: number;
  size?: 'sm' | 'md';
  className?: string;
};

export default function TeamAvatarStack({
  members,
  maxVisible = 4,
  size = 'sm',
  className,
}: TeamAvatarStackProps) {
  if (members.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
        <Users className="h-3 w-3" /> No members
      </span>
    );
  }

  const visibleMembers = members.slice(0, maxVisible);
  const remainingCount = members.length - visibleMembers.length;
  const isSmall = size === 'sm';
  const avatarSize = isSmall ? 'h-6 w-6' : 'h-7 w-7';

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-center -space-x-2 py-0.5', className)}>
        {visibleMembers.map((member, index) => {
          const user = member.user;
          const fallbackId = user.id || member.userId || user.name;
          const avatarUrl = user.avatarUrl || getDefaultAvatar(user.gender, fallbackId);

          return (
            <Tooltip key={fallbackId || index}>
              <TooltipTrigger asChild>
                <div className="relative inline-flex shrink-0 transition-transform hover:z-20 hover:scale-110">
                  <DirectUserAvatar
                    avatarUrl={avatarUrl}
                    name={user.name}
                    size="xs"
                    className={cn(avatarSize, 'ring-2 ring-card shadow-xs')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-semibold">{user.name}</p>
                {member.role && (
                  <p className="text-[10px] text-muted-foreground uppercase">{member.role}</p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {remainingCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  avatarSize,
                  'relative inline-flex items-center justify-center rounded-full bg-muted font-bold text-[10px] text-muted-foreground ring-2 ring-card shadow-xs cursor-default shrink-0 z-10'
                )}
              >
                +{remainingCount}
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p>
                {remainingCount} more team {remainingCount === 1 ? 'member' : 'members'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
