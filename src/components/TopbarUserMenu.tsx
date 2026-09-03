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
import { Settings, LogOut, User, Keyboard, HelpCircle, ChevronDown, Activity } from 'lucide-react';
import { useUserAvatarSafe } from '@/hooks/useUserAvatar';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type Props = {
  name: string | null;
  email: string | null;
  role: string | null;
  avatarUrl: string | null;
  gender: string | null;
  userId: string;
};

export default function TopbarUserMenu({ name, email, role, avatarUrl, gender, userId }: Props) {
  const router = useRouter();
  const finalAvatarUrl = useUserAvatarSafe(userId, gender, name || email || 'User', avatarUrl);
  const initials = (name || email || 'U').slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group flex items-center gap-1.5 p-1 pl-1.5 pr-2 rounded-full border border-border/70 hover:border-border hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-colors cursor-pointer"
          aria-label="User account menu"
        >
          {/* Avatar with online dot */}
          <div className="relative shrink-0">
            <Avatar className="h-7 w-7 rounded-full border border-black/5 dark:border-white/10 shadow-xs">
              <AvatarImage
                src={finalAvatarUrl}
                alt={name || 'User'}
                className="object-cover h-full w-full"
              />
              <AvatarFallback className="flex items-center justify-center h-full w-full bg-primary/10 text-primary font-semibold text-[11px]">
                {initials}
              </AvatarFallback>
            </Avatar>
            <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-background bg-emerald-500 shadow-xs" />
          </div>

          {/* Chevron Dropdown Indicator with open rotation */}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        className="w-56 p-1.5 overflow-hidden border border-border shadow-xl bg-popover/95 backdrop-blur-xl z-[1050] rounded-xl"
        align="end"
      >
        {/* User Info Header */}
        <DropdownMenuLabel className="p-2 font-normal">
          <div className="flex flex-col space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold leading-none truncate text-foreground">
                {name || 'User'}
              </p>
              {role && (
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shadow-2xs inline-block shrink-0',
                    {
                      'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/20':
                        role.toLowerCase() === 'admin',
                      'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/20':
                        role.toLowerCase() === 'responder',
                      'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20':
                        role.toLowerCase() === 'observer',
                      'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/20':
                        !['admin', 'responder', 'observer'].includes(role.toLowerCase()),
                    }
                  )}
                >
                  {role}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{email || 'No email'}</p>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-1 bg-border/60" />

        {/* Primary Navigation */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            asChild
            className="group cursor-pointer focus:bg-accent focus:text-accent-foreground rounded-lg py-1.5 px-2 text-xs"
          >
            <Link href="/settings/profile" className="flex items-center w-full">
              <User className="mr-2 h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1">My Profile</span>
              <DropdownMenuShortcut className="text-[10px] text-muted-foreground">
                ⇧⌘P
              </DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            asChild
            className="group cursor-pointer focus:bg-accent focus:text-accent-foreground rounded-lg py-1.5 px-2 text-xs"
          >
            <Link href="/settings" className="flex items-center w-full">
              <Settings className="mr-2 h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1">Settings</span>
              <DropdownMenuShortcut className="text-[10px] text-muted-foreground">
                ⌘S
              </DropdownMenuShortcut>
            </Link>
          </DropdownMenuItem>

          <DropdownMenuItem
            asChild
            className="group cursor-pointer focus:bg-accent focus:text-accent-foreground rounded-lg py-1.5 px-2 text-xs"
          >
            <Link href="/status" className="flex items-center w-full">
              <Activity className="mr-2 h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1">Status Page</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-1 bg-border/60" />

        {/* Support & Shortcuts */}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
            className="group cursor-pointer focus:bg-accent focus:text-accent-foreground rounded-lg py-1.5 px-2 text-xs"
          >
            <Keyboard className="mr-2 h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="flex-1">Keyboard Shortcuts</span>
            <DropdownMenuShortcut className="text-[10px] text-muted-foreground">
              ?
            </DropdownMenuShortcut>
          </DropdownMenuItem>

          <DropdownMenuItem
            asChild
            className="group cursor-pointer focus:bg-accent focus:text-accent-foreground rounded-lg py-1.5 px-2 text-xs"
          >
            <Link href="/help" className="flex items-center w-full">
              <HelpCircle className="mr-2 h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              <span className="flex-1">Help & Documentation</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-1 bg-border/60" />

        {/* Sign Out */}
        <DropdownMenuItem
          className="group cursor-pointer focus:bg-rose-50 dark:focus:bg-rose-950/40 text-rose-600 dark:text-rose-400 focus:text-rose-700 dark:focus:text-rose-300 rounded-lg py-1.5 px-2 text-xs"
          onClick={() => router.push('/auth/signout')}
        >
          <LogOut className="mr-2 h-3.5 w-3.5 text-rose-500 group-hover:text-rose-600 transition-colors" />
          <span className="font-medium flex-1">Sign Out</span>
          <DropdownMenuShortcut className="text-[10px] text-rose-500">⇧⌘Q</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
