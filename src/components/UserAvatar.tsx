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

const AVATAR_PALETTES = [
  {
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200/80 dark:border-blue-800/60',
  },
  {
    bg: 'bg-indigo-50 dark:bg-indigo-950/40',
    text: 'text-indigo-700 dark:text-indigo-300',
    border: 'border-indigo-200/80 dark:border-indigo-800/60',
  },
  {
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-200/80 dark:border-violet-800/60',
  },
  {
    bg: 'bg-sky-50 dark:bg-sky-950/40',
    text: 'text-sky-700 dark:text-sky-300',
    border: 'border-sky-200/80 dark:border-sky-800/60',
  },
  {
    bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200/80 dark:border-emerald-800/60',
  },
  {
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200/80 dark:border-teal-800/60',
  },
];

function getAvatarPalette(str: string | null | undefined) {
  if (!str) return AVATAR_PALETTES[0];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const mod = Math.abs(hash) % 6;
  switch (mod) {
    case 1:
      return AVATAR_PALETTES[1];
    case 2:
      return AVATAR_PALETTES[2];
    case 3:
      return AVATAR_PALETTES[3];
    case 4:
      return AVATAR_PALETTES[4];
    case 5:
      return AVATAR_PALETTES[5];
    default:
      return AVATAR_PALETTES[0];
  }
}

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
  const palette = getAvatarPalette(name || userId);

  return (
    <div
      className={cn('relative inline-flex shrink-0 select-none', sizeConfig.container, className)}
    >
      <Avatar
        className={cn(
          'h-full w-full rounded-full overflow-hidden border shadow-2xs',
          palette.border
        )}
      >
        {avatarUrl && (
          <AvatarImage
            src={avatarUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
          />
        )}
        <AvatarFallback
          className={cn(
            'flex h-full w-full items-center justify-center rounded-full font-bold',
            palette.bg,
            palette.text,
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
  const palette = getAvatarPalette(name);

  return (
    <div
      className={cn('relative inline-flex shrink-0 select-none', sizeConfig.container, className)}
    >
      <Avatar
        className={cn(
          'h-full w-full rounded-full overflow-hidden border shadow-2xs',
          palette.border
        )}
      >
        {avatarUrl && (
          <AvatarImage
            src={avatarUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
          />
        )}
        <AvatarFallback
          className={cn(
            'flex h-full w-full items-center justify-center rounded-full font-bold',
            palette.bg,
            palette.text,
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
