'use client';

import { useRouter } from 'next/navigation';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import UserAvatar from '@/components/UserAvatar';
import { Settings, LogOut, User, Keyboard, HelpCircle } from 'lucide-react';
import { useUserAvatarSafe } from '@/hooks/useUserAvatar';
import Link from 'next/link';
import AppearanceControl from '@/components/theme/AppearanceControl';

type Props = {
  name: string | null;
  email: string | null;
  role: string | null;
  avatarUrl: string | null;
  gender: string | null;
  userId: string;
  legalNotice?: React.ReactNode;
};

export default function TopbarUserMenu({
  name,
  email,
  role,
  avatarUrl,
  gender,
  userId,
  legalNotice,
}: Props) {
  const router = useRouter();
  const finalAvatarUrl = useUserAvatarSafe(userId, gender, name || email || 'User', avatarUrl);
  const initials = (name || email || 'U').slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-10 w-10 rounded-full p-0 transition-all duration-300 hover:scale-105 group ring-0 focus-visible:ring-2 focus-visible:ring-offset-2 overflow-hidden"
        >
          {/* 1. Outer Gradient Frame */}
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 via-muted to-primary/20 group-hover:from-primary/40 group-hover:via-primary/10 group-hover:to-primary/40 transition-all duration-500" />

          {/* 2. Slate Gap */}
          <div className="absolute inset-[2px] rounded-full bg-zinc-900" />

          {/* 3. Avatar Image */}
          <Avatar className="absolute inset-[3px] h-[calc(100%-6px)] w-[calc(100%-6px)] rounded-full border border-black/5 dark:border-white/10 shadow-sm">
            <AvatarImage
              src={finalAvatarUrl}
              alt={name || 'User'}
              className="object-cover h-full w-full"
            />
            <AvatarFallback className="flex items-center justify-center h-full w-full bg-gradient-to-br from-primary/10 to-primary/20 text-primary font-bold text-[10px]">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="z-[1050] w-64" align="end">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <UserAvatar
            userId={userId}
            avatarUrl={finalAvatarUrl}
            name={name}
            gender={gender}
            size="sm"
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span className="truncate">{name || 'User'}</span>
              {role && (
                <Badge variant="neutral" size="xs" className="shrink-0 uppercase">
                  {role}
                </Badge>
              )}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={email ?? undefined}>
              {email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings/profile">
              <User />
              <span className="flex-1">My Profile</span>
              <DropdownMenuShortcut>⇧⌘P</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings">
              <Settings />
              <span className="flex-1">Settings</span>
              <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <div className="px-2 pb-1.5">
          <AppearanceControl size="sm" />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
          >
            <Keyboard />
            <span className="flex-1">Keyboard Shortcuts</span>
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/help">
              <HelpCircle />
              <span className="flex-1">Help & Documentation</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push('/auth/signout')}>
          <LogOut />
          <span className="flex-1">Sign Out</span>
          <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
        {legalNotice && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-2xs text-muted-foreground">
              {legalNotice}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
