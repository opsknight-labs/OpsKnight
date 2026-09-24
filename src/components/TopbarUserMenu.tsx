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
          <div className="absolute inset-[2px] rounded-full bg-slate-900" />

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
      <DropdownMenuContent
        className="w-64 p-1 overflow-hidden border border-border shadow-xl bg-white/95 dark:bg-[#121216]/95 backdrop-blur-xl z-[1050] rounded-xl"
        align="end"
      >
        {/* Comfortable Header matching Create dropdown */}
        <div className="relative p-3 bg-gradient-to-br from-[#18181b] via-[#121216] to-[#09090b] text-white overflow-hidden rounded-lg mb-1 border-b border-zinc-800/80">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_50%)]" />

          <div className="relative z-10 flex items-center gap-2.5">
            <Avatar className="h-8 w-8 border border-zinc-700/60 shadow-xs shrink-0">
              <AvatarImage src={finalAvatarUrl} />
              <AvatarFallback className="bg-white/10 text-white backdrop-blur-md text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col min-w-0 flex-1">
              <p className="text-sm font-semibold truncate leading-tight text-white">
                {name || 'User'}
              </p>
              <p className="text-xs text-zinc-400 font-normal truncate">{email}</p>
              {role && (
                <span
                  className={cn(
                    'mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider border shadow-xs inline-block w-fit',
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
              className="group cursor-pointer focus:bg-muted/70 data-[highlighted]:bg-muted/70 rounded-lg py-2 px-2"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800/60 text-zinc-600 dark:text-zinc-400 mr-2.5 group-hover:bg-zinc-200 dark:group-hover:bg-zinc-700/60 transition-all shadow-xs border border-zinc-200 dark:border-zinc-700/40 shrink-0">
                <Keyboard className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground">Keyboard Shortcuts</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                ?
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              asChild
              className="group cursor-pointer focus:bg-muted/70 data-[highlighted]:bg-muted/70 rounded-lg py-2 px-2"
            >
              <Link href="/help" className="flex items-center w-full">
                <div className="flex items-center justify-center w-6 h-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 mr-2.5 group-hover:bg-emerald-100 dark:group-hover:bg-emerald-900/50 transition-all shadow-xs border border-emerald-100 dark:border-emerald-900/40 shrink-0">
                  <HelpCircle className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">Help & Documentation</span>
                </div>
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

        {legalNotice && (
          <div className="py-1.5 px-3 bg-muted/40 border-t flex items-center justify-center gap-1.5 rounded-b-lg text-[10px] text-muted-foreground/80">
            {legalNotice}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
