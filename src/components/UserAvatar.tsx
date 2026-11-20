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
  /** Set when the name is shown next to the avatar, so screen readers don't read it twice. */
  'aria-hidden'?: boolean;
};

const SIZE_CLASSES = new Map<AvatarSize, { container: string; text: string }>([
  ['xs', { container: 'h-6 w-6', text: 'text-2xs' }],
  ['sm', { container: 'h-8 w-8', text: 'text-2xs' }],
  ['md', { container: 'h-10 w-10', text: 'text-xs' }],
  ['lg', { container: 'h-12 w-12', text: 'text-sm' }],
  ['xl', { container: 'h-16 w-16', text: 'text-base' }],
  ['2xl', { container: 'h-24 w-24', text: 'text-xl' }],
]);

const AVATAR_PALETTES = [
  {
    bg: 'bg-blue-50 dark:bg-blue-900/70',
    text: 'text-blue-700 dark:text-blue-100',
    border: 'border-blue-200/80 dark:border-blue-700/70',
  },
  {
    bg: 'bg-indigo-50 dark:bg-indigo-900/70',
    text: 'text-indigo-700 dark:text-indigo-100',
    border: 'border-indigo-200/80 dark:border-indigo-700/70',
  },
  {
    bg: 'bg-violet-50 dark:bg-violet-900/70',
    text: 'text-violet-700 dark:text-violet-100',
    border: 'border-violet-200/80 dark:border-violet-700/70',
  },
  {
    bg: 'bg-sky-50 dark:bg-sky-900/70',
    text: 'text-sky-700 dark:text-sky-100',
    border: 'border-sky-200/80 dark:border-sky-700/70',
  },
  {
    bg: 'bg-emerald-50 dark:bg-emerald-900/70',
    text: 'text-emerald-700 dark:text-emerald-100',
    border: 'border-emerald-200/80 dark:border-emerald-700/70',
  },
  {
    bg: 'bg-teal-50 dark:bg-teal-900/70',
    text: 'text-teal-700 dark:text-teal-100',
    border: 'border-teal-200/80 dark:border-teal-700/70',
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
  className,
  fallbackClassName,
  'aria-hidden': ariaHidden,
}: UserAvatarProps) {
  const contextAvatarUrl = useUserAvatarSafe(userId, gender, name, directAvatarUrl);
  const avatarUrl = directAvatarUrl || contextAvatarUrl;
  const sizeConfig = SIZE_CLASSES.get(size) ?? { container: 'h-10 w-10', text: 'text-xs' };
  const palette = getAvatarPalette(name || userId);

  // A span (not a div) so the avatar is valid inside <p>, <a>, <button> and <label>;
  // a div inside <p> makes the browser split the paragraph and breaks hydration.
  return (
    <span
      aria-hidden={ariaHidden || undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none rounded-full',
        sizeConfig.container,
        className
      )}
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
            alt={ariaHidden ? '' : name || 'User avatar'}
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
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
    </span>
  );
}
