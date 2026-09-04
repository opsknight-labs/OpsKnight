'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/shadcn/tooltip';
import { X, HelpCircle, Settings, LogOut, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';
import UserAvatar from '@/components/UserAvatar';
import BrandLockup from '@/components/layout/BrandLockup';
import { APP_VERSION } from '@/lib/constants';
import {
  NavItemConfig,
  getNavSectionConfig,
  NavSectionKey,
  getAuthorizedNavItems,
  groupNavItemsBySection,
} from '@/config/navigation';

type SidebarProps = {
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  userAvatar?: string | null;
  userGender?: string | null;
  userId?: string;
};

export default function Sidebar({
  userName = null,
  userEmail = null,
  userRole = null,
  userAvatar = null,
  userGender = null,
  userId = 'user',
}: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isCollapsed, isMobile, isMobileOpen, closeMobile } = useSidebar();

  // Prefer client session data for reactive updates
  const currentName = session?.user?.name || userName;
  const currentEmail = session?.user?.email || userEmail;
  const currentRole = (session?.user as { role?: string } | undefined)?.role || userRole;
  const currentGender = (session?.user as { gender?: string } | undefined)?.gender || userGender;

  const [stats, setStats] = useState<{ count: number; calculatedAt?: string } | null>(null);

  const isDesktopCollapsed = !isMobile && isCollapsed;
  const sidebarId = 'app-sidebar';

  // Fetch real-time active incident counts
  useEffect(() => {
    let isMounted = true;
    fetch('/api/sidebar-stats')
      .then(async res => {
        if (!res.ok) throw new Error('Stats unavailable');
        return res.json();
      })
      .then(data => {
        if (!isMounted) return;
        if (typeof data?.activeIncidentsCount === 'number') {
          setStats({
            count: data.activeIncidentsCount,
            calculatedAt: data.calculatedAt,
          });
        }
      })
      .catch(() => {
        if (isMounted) setStats(null);
      });

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  // Close mobile drawer on route change
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      prevPathnameRef.current = pathname;
      closeMobile();
    }
  }, [pathname, closeMobile]);

  const isActive = (path: string) => {
    if (path === '/' && pathname === '/') return true;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return false;
  };

  // Centralized filtered and grouped items
  const groupedItems = useMemo(() => {
    const authorized = getAuthorizedNavItems(currentRole);
    return groupNavItemsBySection(authorized);
  }, [currentRole]);

  // Render a single navigation link (with tooltips when collapsed)
  const renderNavItem = (item: NavItemConfig) => {
    const active = isActive(item.href);
    const hasIncidents = item.badgeKey === 'incidents' && stats !== null && stats.count > 0;
    const badgeText = stats?.count && stats.count > 99 ? '99+' : `${stats?.count ?? 0}`;
    const IconComponent = item.icon;

    const linkContent = (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={
          isDesktopCollapsed ? `${item.label}${hasIncidents ? ` (${badgeText})` : ''}` : undefined
        }
        className={cn(
          'group relative flex items-center rounded-lg font-medium transition-all duration-150 select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
          // Hover and active states
          'text-slate-400 hover:text-white hover:bg-slate-800/60',
          active
            ? 'bg-slate-800/90 text-white font-semibold shadow-xs ring-1 ring-white/10'
            : 'text-slate-400',
          // Sizing
          isDesktopCollapsed
            ? 'h-10 w-10 justify-center p-0 mx-auto'
            : 'px-2.5 py-2 gap-2.5 text-[13px] w-full'
        )}
      >
        {/* Active edge indicator line (expanded only) */}
        {active && !isDesktopCollapsed && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-gradient-to-b from-red-500 to-rose-600 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
        )}

        {/* Icon */}
        <span
          className={cn(
            'shrink-0 flex items-center justify-center transition-transform duration-150',
            active ? 'text-rose-400' : 'text-slate-400 group-hover:text-white',
            'group-hover:scale-105'
          )}
        >
          <IconComponent className="h-[18px] w-[18px]" />
        </span>

        {/* Label (expanded only) */}
        {!isDesktopCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}

        {/* Incident Badge */}
        {hasIncidents &&
          (isDesktopCollapsed ? (
            <span
              aria-label={`${stats!.count} active incidents`}
              className="absolute top-1 right-1 flex h-2.5 w-2.5"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
            </span>
          ) : (
            <Badge
              variant="sidebar-danger"
              size="xs"
              aria-label={`${stats!.count} active incidents`}
              title={stats?.calculatedAt ? `Updated ${stats.calculatedAt}` : undefined}
              className="ml-auto h-4.5 min-w-4.5 px-1.5 rounded-full text-[10.5px] font-bold bg-rose-500 text-white border-0 shadow-xs"
            >
              {badgeText}
            </Badge>
          ))}
      </Link>
    );

    // If collapsed on desktop, wrap with Tooltip
    if (isDesktopCollapsed) {
      return (
        <Tooltip key={item.href} delayDuration={150}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent
            side="right"
            sideOffset={12}
            className="text-xs py-1 px-2.5 flex items-center gap-2 bg-slate-900 text-white border-slate-700 shadow-xl"
          >
            <span className="font-medium">{item.label}</span>
            {hasIncidents && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white">
                {badgeText}
              </span>
            )}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div key={item.href}>{linkContent}</div>;
  };

  // Render a navigation section
  const renderSection = (sectionKey: NavSectionKey, items: NavItemConfig[]) => {
    if (!items || items.length === 0) return null;
    const sectionConfig = getNavSectionConfig(sectionKey);

    return (
      <div
        key={sectionKey}
        className={cn('w-full', isDesktopCollapsed ? 'mb-2.5' : 'mb-3')}
        data-section={sectionKey}
      >
        {!isDesktopCollapsed && sectionConfig?.label && (
          <div className="flex items-center gap-1.5 mb-1.5 px-2">
            {sectionConfig.dotClass && (
              <div className={cn('h-1.5 w-1.5 rounded-full shrink-0', sectionConfig.dotClass)} />
            )}
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">
              {sectionConfig.label}
            </span>
          </div>
        )}

        <div className={cn('flex flex-col gap-1', isDesktopCollapsed && 'items-center')}>
          {items.map(renderNavItem)}
        </div>
      </div>
    );
  };

  return (
    <TooltipProvider delayDuration={200}>
      {/* Mobile Backdrop Overlay */}
      {isMobile && isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in-0 duration-200"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      {/* Main Sidebar Shell */}
      <aside
        id={sidebarId}
        aria-label="Main navigation"
        aria-hidden={isMobile && !isMobileOpen}
        data-collapsed={isDesktopCollapsed ? 'true' : 'false'}
        className={cn(
          // Base styles
          'sidebar flex flex-col select-none transition-all duration-200 ease-in-out',
          // Desktop positioning: Flush below top header
          !isMobile && [
            'fixed top-14 left-0 bottom-0 z-30',
            'h-[calc(100vh-3.5rem)] h-[calc(100dvh-3.5rem)]',
            isDesktopCollapsed
              ? 'sidebar-collapsed w-[var(--sidebar-width-collapsed,64px)]'
              : 'w-[var(--sidebar-width,240px)]',
          ],
          // Mobile positioning: Drawer slide-in
          isMobile && [
            'sidebar-mobile',
            'fixed top-0 left-0 bottom-0 z-50 w-72 h-full shadow-2xl',
            'transform transition-transform duration-250 ease-out',
            isMobileOpen
              ? 'sidebar-mobile-open translate-x-0'
              : '-translate-x-full pointer-events-none',
          ]
        )}
      >
        {/* Mobile Header (Shown ONLY in mobile drawer) */}
        {isMobile && (
          <div className="flex items-center justify-between px-4 h-14 border-b border-border/70 shrink-0 bg-background">
            <BrandLockup variant="mobile" />
            <Button
              onClick={closeMobile}
              aria-label="Close navigation menu"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        )}

        {/* Scrollable Navigation Area */}
        <nav
          className={cn(
            'sidebar-nav flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain',
            '[scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.45)_transparent]',
            '[&::-webkit-scrollbar]:w-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:bg-slate-600/50 hover:[&::-webkit-scrollbar-thumb]:bg-slate-400/80 active:[&::-webkit-scrollbar-thumb]:bg-rose-500/90 [&::-webkit-scrollbar-thumb]:rounded-full transition-colors',
            isDesktopCollapsed ? 'py-3 px-2' : 'p-3'
          )}
        >
          {renderSection('MAIN', groupedItems.MAIN)}
          {renderSection('OPERATIONS', groupedItems.OPERATIONS)}
          {renderSection('INSIGHTS', groupedItems.INSIGHTS)}
        </nav>

        {/* Sidebar Footer Section */}
        <div
          className={cn(
            'mt-auto shrink-0 border-t border-white/10 bg-slate-950/60',
            isDesktopCollapsed ? 'p-2' : 'p-3'
          )}
        >
          {/* User Info Row */}
          <div
            className={cn('flex items-center gap-2.5', isDesktopCollapsed ? 'justify-center' : '')}
          >
            {isDesktopCollapsed ? (
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <div className="cursor-pointer">
                    <UserAvatar
                      userId={userId || 'user'}
                      name={currentName}
                      gender={currentGender}
                      avatarUrl={userAvatar}
                      size="sm"
                      showOnlineStatus={true}
                      className="border-white/10 h-8 w-8 shrink-0 hover:scale-105 transition-transform"
                      fallbackClassName="bg-indigo-500/20 text-indigo-200 text-xs"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="text-xs bg-slate-900 text-white border-slate-700 shadow-xl"
                >
                  <p className="font-semibold">{currentName || 'User'}</p>
                  <p className="text-slate-400 text-[10px]">{currentEmail}</p>
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <UserAvatar
                  userId={userId || 'user'}
                  name={currentName}
                  gender={currentGender}
                  avatarUrl={userAvatar}
                  size="sm"
                  showOnlineStatus={true}
                  className="border-white/10 h-8 w-8 shrink-0"
                  fallbackClassName="bg-indigo-500/20 text-indigo-200 text-xs"
                />
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-[13px] font-semibold text-white truncate">
                    {currentName || 'User'}
                  </div>
                  <div className="text-[11px] text-slate-400 font-medium truncate">
                    {currentEmail || 'user@example.com'}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Quick Action Bar (Expanded) */}
          {!isDesktopCollapsed && (
            <div className="grid grid-cols-4 gap-1 mt-2.5 pt-2 border-t border-white/5">
              <Link
                href="/help"
                className="flex items-center justify-center h-7 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                title="Help & Support"
                aria-label="Help & Support"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
                className="flex items-center justify-center h-7 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                title="Keyboard Shortcuts (?)"
                aria-label="Keyboard Shortcuts"
              >
                <Keyboard className="h-3.5 w-3.5" />
              </button>
              <Link
                href="/settings"
                className="flex items-center justify-center h-7 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                title="Settings"
                aria-label="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Link>
              <Link
                href="/auth/signout"
                className="flex items-center justify-center h-7 rounded-md hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Link>
            </div>
          )}

          {/* Quick Action Bar (Collapsed) */}
          {isDesktopCollapsed && (
            <div className="mt-2 flex flex-col gap-1.5 items-center pt-2 border-t border-white/10">
              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <Link
                    href="/settings"
                    className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                    aria-label="Settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="text-xs bg-slate-900 text-white border-slate-700 shadow-xl"
                >
                  Settings
                </TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={150}>
                <TooltipTrigger asChild>
                  <Link
                    href="/auth/signout"
                    className="flex items-center justify-center h-8 w-8 rounded-md hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-colors"
                    aria-label="Sign Out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  sideOffset={12}
                  className="text-xs bg-slate-900 text-white border-slate-700 shadow-xl"
                >
                  Sign Out
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Metadata version info */}
          {!isDesktopCollapsed && (
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px] text-slate-500">
              <span>opsknight.com</span>
              <span className="font-mono">{APP_VERSION}</span>
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
