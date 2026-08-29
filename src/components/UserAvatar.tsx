'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { useUserAvatarSafe } from '@/hooks/useUserAvatar';
import { cn } from '@/lib/utils';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

type UserAvatarProps = {
  userId: string;
  avatarUrl?: string | null;
  name?: string | null;
  gender?: string | null;
  size?: AvatarSize;
  showOnlineStatus?: boolean;
  className?: string;
  fallbackClassName?: string;
};

const sizeClasses: Record<AvatarSize, { container: string; text: string; statusDot: string }> = {
  xs: {
    container: 'h-6 w-6',
    text: 'text-[9px]',
    statusDot: 'h-1.5 w-1.5 -bottom-0 -right-0 border',
  },
  sm: {
    container: 'h-8 w-8',
    text: 'text-[10px]',
    statusDot: 'h-2 w-2 -bottom-0.5 -right-0.5 border-[1.5px]',
  },
  md: {
    container: 'h-10 w-10',
    text: 'text-xs',
    statusDot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5 border-[1.5px]',
  },
  lg: {
    container: 'h-12 w-12',
    text: 'text-sm',
    statusDot: 'h-3 w-3 -bottom-0.5 -right-0.5 border-2',
  },
  xl: {
    container: 'h-16 w-16',
    text: 'text-base',
    statusDot: 'h-3.5 w-3.5 -bottom-0.5 -right-0.5 border-2',
  },
  '2xl': {
    container: 'h-24 w-24',
    text: 'text-xl',
    statusDot: 'h-4 w-4 bottom-0.5 right-0.5 border-2',
  },
};

function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length > 1) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function UserAvatar({
  userId,
  avatarUrl: directAvatarUrl,
  name,
  gender,
  size = 'md',
  showOnlineStatus = false,
  className,
  fallbackClassName,
}: UserAvatarProps) {
  const contextAvatarUrl = useUserAvatarSafe(userId, gender, name, directAvatarUrl);
  const avatarUrl = directAvatarUrl || contextAvatarUrl;
  const sizeConfig = sizeClasses[size];
  const initials = getInitials(name);

  return (
    <div
      className={cn('relative inline-flex shrink-0 select-none', sizeConfig.container, className)}
    >
      <Avatar className="h-full w-full rounded-full overflow-hidden border border-border/80 bg-muted/30 shadow-2xs">
        {avatarUrl && (
          <AvatarImage
            src={avatarUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
          />
        )}
        <AvatarFallback
          className={cn(
            'flex h-full w-full items-center justify-center rounded-full bg-primary/10 font-bold text-primary',
            sizeConfig.text,
            fallbackClassName
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      {showOnlineStatus && (
        <span
          className={cn(
            'absolute rounded-full bg-emerald-500 border-background',
            sizeConfig.statusDot
          )}
          aria-label="Online"
        />
      )}
    </div>
  );
}

// Export a version that works with direct avatar URL for special cases
type DirectUserAvatarProps = Omit<UserAvatarProps, 'userId' | 'gender'> & {
  avatarUrl: string;
};

export function DirectUserAvatar({
  avatarUrl,
  name,
  size = 'md',
  showOnlineStatus = false,
  className,
  fallbackClassName,
}: DirectUserAvatarProps) {
  const sizeConfig = sizeClasses[size];
  const initials = getInitials(name);

  return (
    <div
      className={cn('relative inline-flex shrink-0 select-none', sizeConfig.container, className)}
    >
      <Avatar className="h-full w-full rounded-full overflow-hidden border border-border/80 bg-muted/30 shadow-2xs">
        {avatarUrl && (
          <AvatarImage
            src={avatarUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
          />
        )}
        <AvatarFallback
          className={cn(
            'flex h-full w-full items-center justify-center rounded-full bg-primary/10 font-bold text-primary',
            sizeConfig.text,
            fallbackClassName
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>

      {showOnlineStatus && (
        <span
          className={cn(
            'absolute rounded-full bg-emerald-500 border-background',
            sizeConfig.statusDot
          )}
          aria-label="Online"
        />
      )}
    </div>
  );
}
