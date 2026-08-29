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
    text: 'text-[8px]',
    statusDot: 'h-1.5 w-1.5 -bottom-0 -right-0 border',
  },
  sm: {
    container: 'h-8 w-8',
    text: 'text-[9px]',
    statusDot: 'h-2 w-2 -bottom-0.5 -right-0.5 border-[1.5px]',
  },
  md: {
    container: 'h-10 w-10',
    text: 'text-[10px]',
    statusDot: 'h-2.5 w-2.5 -bottom-0.5 -right-0.5 border-[1.5px]',
  },
  lg: {
    container: 'h-12 w-12',
    text: 'text-xs',
    statusDot: 'h-3 w-3 -bottom-0.5 -right-0.5 border-2',
  },
  xl: {
    container: 'h-16 w-16',
    text: 'text-sm',
    statusDot: 'h-3.5 w-3.5 -bottom-0.5 -right-0.5 border-2',
  },
  '2xl': {
    container: 'h-32 w-32',
    text: 'text-2xl',
    statusDot: 'h-5 w-5 bottom-1 right-1 border-[3px]',
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
    <div className={cn('relative shrink-0', sizeConfig.container, className)}>
      <Avatar className="h-full w-full border border-black/5 dark:border-white/10 shadow-xs">
        <AvatarImage
          src={avatarUrl}
          alt={name || 'User avatar'}
          className="object-cover h-full w-full"
        />
        <AvatarFallback
          className={cn(
            'flex items-center justify-center h-full w-full',
            'bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-bold',
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
    <div className={cn('relative shrink-0', sizeConfig.container, className)}>
      <Avatar className="h-full w-full border border-black/5 dark:border-white/10 shadow-xs">
        <AvatarImage
          src={avatarUrl}
          alt={name || 'User avatar'}
          className="object-cover h-full w-full"
        />
        <AvatarFallback
          className={cn(
            'flex items-center justify-center h-full w-full',
            'bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-bold',
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
