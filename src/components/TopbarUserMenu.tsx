'use client';

import { useRouter } from 'next/navigation';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
import { Button } from '@/components/ui/shadcn/button';
import { Settings, LogOut, User, Keyboard, HelpCircle } from 'lucide-react';
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
        <Button
          variant="ghost"
          className="relative h-10 w-10 rounded-full p-0 transition-all duration-300 hover:scale-105 group ring-0 focus-visible:ring-2 focus-visible:ring-offset-2 overflow-hidden"
        >
          {/* 1. Outer Gradient Frame */}
          <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 via-muted to-primary/20 group-hover:from-primary/40 group-hover:via-primary/10 group-hover:to-primary/40 transition-all duration-500" />

          {/* 2. White/Background Gap */}
          <div className="absolute inset-[2px] rounded-full bg-background" />

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

          {/* 4. Online Status Dot */}
          <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full border-[1.5px] border-background bg-emerald-500 shadow-sm z-20" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-64 p-1 overflow-hidden border border-border shadow-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl z-[1050] rounded-xl"
        align="end"
      >
        {/* Comfortable Header */}
        <div className="relative p-3 bg-gradient-to-br from-primary/90 via-primary to-primary/90 text-primary-foreground overflow-hidden rounded-lg mb-1 border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_50%)]" />

          <div className="relative z-10 flex items-center gap-2.5">
            <Avatar className="h-8 w-8 border border-white/20 shadow-sm shrink-0">
              <AvatarImage src={finalAvatarUrl} />
              <AvatarFallback className="bg-white/10 text-white backdrop-blur-md text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight text-white">
                {name || 'User'}
              </p>
              <p className="text-xs text-white/75 font-normal truncate">{email}</p>
              {role && (
                <span
                  className={cn(
                    'mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shadow-sm backdrop-blur-md inline-block w-fit',
                    {
                      'text-rose-200 bg-rose-500/20 border-rose-500/30':
                        role?.toLowerCase() === 'admin',
                      'text-indigo-200 bg-indigo-500/20 border-indigo-500/30':
                        role?.toLowerCase() === 'responder',
                      'text-emerald-200 bg-emerald-500/20 border-emerald-500/30':
                        role?.toLowerCase() === 'observer',
                      'text-sky-200 bg-sky-500/20 border-sky-500/30': ![
                        'admin',
                        'responder',
                        'observer',
                      ].includes(role?.toLowerCase() || ''),
                    }
                  )}
                >
                  {role}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="p-0.5 space-y-0.5">
          <DropdownMenuGroup>
            <DropdownMenuItem
              asChild
              className="group cursor-pointer focus:bg-muted/70 data-[highlighted]:bg-muted/70 rounded-lg py-2 px-2"
            >
              <Link href="/settings/profile" className="flex items-center w-full">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 mr-2.5 group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 transition-all shadow-xs border border-blue-100 dark:border-blue-900/40 shrink-0">
                  <User className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">My Profile</span>
                  <span className="text-[10px] text-muted-foreground leading-tight truncate">
                    Details & preferences
                  </span>
                </div>
                <DropdownMenuShortcut className="text-[9px] bg-muted px-1 py-0.5 rounded border border-border/50">
                  ⇧⌘P
                </DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>

            <DropdownMenuItem
              asChild
              className="group cursor-pointer focus:bg-muted/70 data-[highlighted]:bg-muted/70 rounded-lg py-2 px-2"
            >
              <Link href="/settings" className="flex items-center w-full">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 mr-2.5 group-hover:bg-purple-100 dark:group-hover:bg-purple-900/50 transition-all shadow-xs border border-purple-100 dark:border-purple-900/40 shrink-0">
                  <Settings className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">Settings</span>
                  <span className="text-[10px] text-muted-foreground leading-tight truncate">
                    System configuration
                  </span>
                </div>
                <DropdownMenuShortcut className="text-[9px] bg-muted px-1 py-0.5 rounded border border-border/50">
                  ⌘S
                </DropdownMenuShortcut>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="my-1 bg-border/60" />

          <DropdownMenuGroup>
            <DropdownMenuItem
              onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
              className="group cursor-pointer focus:bg-muted/70 rounded-lg py-2 px-2"
            >
              <Keyboard className="mr-2.5 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
              <span className="text-xs font-medium flex-1">Keyboard Shortcuts</span>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1 rounded border border-border/40">
                ?
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="group cursor-pointer focus:bg-muted/70 rounded-lg py-2 px-2"
            >
              <Link href="/help" className="flex items-center w-full">
                <HelpCircle className="mr-2.5 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                <span className="text-xs font-medium flex-1">Help & Documentation</span>
              </Link>
            </DropdownMenuItem>
          </DropdownMenuGroup>

          <DropdownMenuSeparator className="my-1 bg-border/60" />

          <DropdownMenuItem
            className="group cursor-pointer focus:bg-red-50 dark:focus:bg-red-950/40 focus:text-red-600 rounded-lg py-2 px-2 text-red-600 dark:text-red-400"
            onClick={() => router.push('/auth/signout')}
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-red-50 dark:bg-red-950/50 text-red-500 mr-2.5 group-hover:bg-red-100 dark:group-hover:bg-red-900/50 transition-all shadow-xs border border-red-100 dark:border-red-900/40 shrink-0">
              <LogOut className="h-3.5 w-3.5" />
            </div>
            <span className="font-semibold text-xs flex-1">Sign Out</span>
            <DropdownMenuShortcut className="text-[9px] bg-red-100/60 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1 py-0.5 rounded border border-red-200 dark:border-red-800/40">
              ⇧⌘Q
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
