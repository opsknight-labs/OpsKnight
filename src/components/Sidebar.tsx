'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { useModalState } from '@/hooks/useModalState';
import { useSidebar } from '@/contexts/SidebarContext';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  ChevronsLeft,
  ChevronsRight,
  Menu,
  X,
  HelpCircle,
  Settings,
  LogOut,
  Keyboard,
  LayoutDashboard,
  AlertTriangle,
  Server,
  Users,
  User,
  Calendar,
  ShieldAlert,
  FileClock,
  ClipboardList,
  PieChart,
  FileWarning,
  Activity,
  ListTodo,
  BarChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import UserAvatar from '@/components/UserAvatar';
import { APP_VERSION } from '@/lib/constants';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  section?: string;
  requiresRole?: string[];
};

const navigationItems: NavItem[] = [
  // Main Navigation
  {
    href: '/',
    label: 'Dashboard',
    icon: <LayoutDashboard />,
  },
  {
    href: '/incidents',
    label: 'Incidents',
    icon: <AlertTriangle />,
  },
  {
    href: '/services',
    label: 'Services',
    icon: <Server />,
  },

  // Operations Section
  {
    href: '/teams',
    label: 'Teams',
    icon: <Users />,
    section: 'OPERATIONS',
  },
  {
    href: '/users',
    label: 'Users',
    icon: <User />,
  },
  {
    href: '/schedules',
    label: 'Schedules',
    icon: <Calendar />,
    section: 'OPERATIONS',
  },
  {
    href: '/policies',
    label: 'Escalation Policies',
    icon: <ShieldAlert />,
    section: 'OPERATIONS',
  },

  // Insights Section
  {
    href: '/analytics',
    label: 'Analytics',
    icon: <PieChart />,
    section: 'INSIGHTS',
  },
  {
    href: '/postmortems',
    label: 'Postmortems',
    icon: <FileWarning />,
    section: 'INSIGHTS',
  },
  {
    href: '/status',
    label: 'Status Page',
    icon: <Activity />,
    section: 'INSIGHTS',
  },
  {
    href: '/action-items',
    label: 'Action Items',
    icon: <ListTodo />,
    section: 'INSIGHTS',
  },
  {
    href: '/events',
    label: 'Event Logs',
    icon: <FileClock />,
    section: 'INSIGHTS',
  },
  {
    href: '/audit',
    label: 'Audit Log',
    icon: <ClipboardList />,
    section: 'INSIGHTS',
  },
  {
    href: '/reports',
    label: 'Reports & Dashboards',
    icon: <BarChart />,
    section: 'INSIGHTS',
  },
];

type SidebarProps = {
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  userAvatar?: string | null;
  userGender?: string | null;
  userId?: string;
};

export default function Sidebar(
  { userName, userEmail, userRole, userAvatar, userGender, userId }: SidebarProps = {
    userName: null,
    userEmail: null,
    userRole: null,
    userAvatar: null,
    userGender: null,
    userId: 'user',
  }
) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { isCollapsed, isMobile, toggleSidebar } = useSidebar();

  // Prefer client-side session data for immediate updates
  const currentName = session?.user?.name || userName;
  const currentEmail = session?.user?.email || userEmail;
  const currentRole = (session?.user as any)?.role || userRole;
  const currentGender = (session?.user as any)?.gender || userGender;

  const [stats, setStats] = useState<{
    count: number;
    isClipped?: boolean;
    retentionDays?: number;
  } | null>(null);

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useModalState('sidebarMobileMenu');

  const sidebarId = 'app-sidebar';
  const isDesktopCollapsed = !isMobile && isCollapsed;

  useEffect(() => {
    fetch('/api/sidebar-stats')
      .then(res => res.json())
      .then(data =>
        setStats({
          count: data.activeIncidentsCount || 0,
          isClipped: data.isClipped,
          retentionDays: data.retentionDays,
        })
      )
      .catch(() => setStats({ count: 0 }));
  }, []);

  useEffect(() => {
    if (isMobileMenuOpen) setIsMobileMenuOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!isMobile && isMobileMenuOpen) setIsMobileMenuOpen(false);
  }, [isMobile, isMobileMenuOpen, setIsMobileMenuOpen]);

  const isActive = (path: string) => {
    if (path === '/' && pathname === '/') return true;
    if (path !== '/' && pathname.startsWith(path)) return true;
    return false;
  };

  const groupedItems = useMemo(() => {
    return navigationItems.reduce(
      (acc, item) => {
        if (item.requiresRole) {
          if (!currentRole || !item.requiresRole.includes(currentRole)) return acc;
        }
        const section = item.section || 'MAIN';
        // eslint-disable-next-line security/detect-object-injection
        if (!acc[section]) acc[section] = [];
        acc[section].push(item);
        return acc;
      },
      {} as Record<string, NavItem[]>
    );
  }, [currentRole]);

  const renderNavItem = (item: NavItem) => {
    const active = isActive(item.href);
    const showBadge = item.href === '/incidents' && stats !== null && stats.count > 0;

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={isDesktopCollapsed ? item.label : undefined}
        title={isDesktopCollapsed ? item.label : undefined}
        className={cn(
          'group relative flex items-center rounded-lg font-medium',
          'text-sm',
          'transition-all duration-200 ease-out motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-foreground/0',
          'text-white/85 hover:text-white hover:bg-white/12 hover:shadow-[0_0_12px_rgba(255,255,255,0.05)]',
          'hover:translate-x-0.5',
          active &&
            'bg-white/15 text-white ring-1 ring-white/10 shadow-[0_0_15px_rgba(255,255,255,0.08)]',
          active &&
            'after:absolute after:left-0 after:top-2 after:bottom-2 after:w-[3px] after:rounded-r-full after:bg-white/70',
          isDesktopCollapsed ? 'h-10 w-10 justify-center px-0' : 'px-3 py-2 gap-3'
        )}
      >
        <span
          className={cn(
            'shrink-0 flex items-center justify-center opacity-85 group-hover:opacity-100',
            'transition-transform duration-200 group-hover:scale-110',
            '[&_svg]:h-[18px] [&_svg]:w-[18px] [&_svg]:shrink-0'
          )}
        >
          {item.icon}
        </span>

        {!isDesktopCollapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}

        {showBadge &&
          (isDesktopCollapsed ? (
            <Badge
              variant="sidebar-danger"
              size="xs"
              aria-label={`${stats!.count} active incidents`}
              className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full p-0"
            >
              <span className="sr-only">{stats!.count > 99 ? '99+' : stats!.count}</span>
            </Badge>
          ) : (
            <Badge
              variant="sidebar-danger"
              size="xs"
              aria-label={`${stats!.count} active incidents`}
              className="ml-auto h-5 min-w-5 rounded-full px-1.5"
            >
              {stats!.count > 99 ? '99+' : stats!.count}
            </Badge>
          ))}
      </Link>
    );
  };

  const renderSection = (sectionName: string, items: NavItem[]) => {
    const sectionColors: Record<string, { dotClass: string; textClass: string }> = {
      OPERATIONS: { dotClass: 'bg-blue-500/80', textClass: 'text-white/75' },
      INSIGHTS: { dotClass: 'bg-purple-500/80', textClass: 'text-white/75' },
    };

    // eslint-disable-next-line security/detect-object-injection
    const colors = sectionColors[sectionName] || {
      dotClass: 'bg-white/50',
      textClass: 'text-white/75',
    };

    return (
      <div
        key={sectionName}
        className={cn('w-full', isDesktopCollapsed ? 'mb-3' : 'mb-4')}
        data-section={sectionName}
      >
        {!isDesktopCollapsed && sectionName !== 'MAIN' && (
          <div className="flex items-center gap-2 mb-2 px-1">
            <div className={cn('h-1.5 w-1.5 rounded-full', colors.dotClass)} />
            <span className={cn('text-[11px] font-bold tracking-wide uppercase', colors.textClass)}>
              {sectionName}
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
    <>
      <MobileMenuButton
        isMobile={isMobile}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />
      <MobileBackdrop
        isMobile={isMobile}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      <aside
        id={sidebarId}
        aria-label="Main navigation"
        aria-hidden={isMobile && !isMobileMenuOpen}
        data-collapsed={isDesktopCollapsed ? 'true' : 'false'}
        className={cn(
          'sidebar',
          isDesktopCollapsed && 'sidebar-collapsed',
          isMobile && 'sidebar-mobile',
          isMobileMenuOpen && 'sidebar-mobile-open'
        )}
      >
        {/* Enhanced Header with Branding */}
        <div
          className={cn(
            'relative shrink-0 border-b border-white/10',
            'bg-gradient-to-b from-white/5 to-transparent',
            isDesktopCollapsed ? 'p-3' : 'px-4 py-5'
          )}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(255,255,255,0.05)_0%,transparent_55%)] pointer-events-none" />

          <Link
            href="/"
            className={cn(
              'relative z-10 flex items-center no-underline transition-transform hover:translate-x-0.5',
              isDesktopCollapsed
                ? 'flex-col justify-center gap-2 w-full'
                : 'flex-row justify-start gap-3 w-full'
            )}
          >
            <div
              className={cn(
                'relative shrink-0 rounded-xl border border-white/12 bg-white/8',
                'shadow-md flex items-center justify-center overflow-hidden',
                'transition-transform hover:scale-105',
                isDesktopCollapsed ? 'h-10 w-10' : 'h-11 w-11'
              )}
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.2)_0%,transparent_70%)] pointer-events-none" />
              <Image
                src="/logo.svg"
                alt="OpsKnight logo"
                width={40}
                height={40}
                className={cn(
                  'relative z-10 object-contain',
                  isDesktopCollapsed ? 'h-6 w-6' : 'h-7 w-7'
                )}
              />
            </div>

            {!isDesktopCollapsed && (
              <div className="flex flex-col gap-1 min-w-0 flex-1">
                <h1 className="text-[1.4rem] font-extrabold text-white m-0 leading-none tracking-tighter font-display drop-shadow-sm">
                  OpsKnight
                </h1>
                <span className="text-[0.65rem] text-white/60 font-bold uppercase tracking-widest">
                  Incident Response
                </span>
              </div>
            )}
          </Link>

          {/* Removed - Toggle moved to sidebar edge */}

          {/* Mobile Close Button */}
          {isMobile && isMobileMenuOpen && (
            <Button
              onClick={() => setIsMobileMenuOpen(false)}
              aria-label="Close navigation menu"
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-9 w-9 rounded-lg bg-white/10 border border-white/20 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Enhanced Scrollable Nav */}
        <nav
          className={cn(
            'flex-1 min-h-0 overflow-y-auto overflow-x-hidden',
            'overscroll-contain',
            // Enhanced scrollbar styling
            '[scrollbar-width:thin]',
            '[scrollbar-color:rgba(255,255,255,0.2)_transparent]',
            // Webkit scrollbar
            '[&::-webkit-scrollbar]:w-1.5',
            '[&::-webkit-scrollbar-track]:bg-transparent',
            '[&::-webkit-scrollbar-thumb]:bg-white/20',
            '[&::-webkit-scrollbar-thumb]:rounded-full',
            '[&::-webkit-scrollbar-thumb:hover]:bg-white/35',
            // Standard padding
            isDesktopCollapsed ? 'p-2' : 'p-3'
          )}
        >
          {Object.entries(groupedItems).map(([section, items]) => renderSection(section, items))}
        </nav>

        {/* Compact Footer Redesign */}
        <div
          className={cn(
            'mt-auto shrink-0 border-t border-white/5',
            isDesktopCollapsed ? 'p-2' : 'p-3'
          )}
        >
          {/* User Profile Row */}
          <div
            className={cn(
              'flex items-center gap-3 group',
              isDesktopCollapsed ? 'justify-center' : ''
            )}
          >
            <UserAvatar
              userId={userId || 'user'}
              name={currentName}
              gender={currentGender}
              avatarUrl={userAvatar}
              size={isDesktopCollapsed ? 'sm' : 'sm'}
              showOnlineStatus={true}
              className={cn(
                'border-white/10 transition-transform group-hover:scale-105 shrink-0',
                !isDesktopCollapsed && 'h-9 w-9'
              )}
              fallbackClassName="bg-indigo-500/20 text-indigo-200 backdrop-blur-md"
            />

            {!isDesktopCollapsed && (
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="text-sm font-semibold text-white truncate group-hover:text-indigo-200 transition-colors">
                  {currentName || 'User'}
                </div>
                <div className="text-xs text-white/40 font-medium truncate">
                  {currentEmail || 'user@example.com'}
                </div>
              </div>
            )}
          </div>

          {/* Action Bar */}
          {!isDesktopCollapsed && (
            <div className="grid grid-cols-4 gap-1 mt-3">
              <Link
                href="/help"
                className="flex items-center justify-center h-8 rounded-md hover:bg-white/5 text-white/40 hover:text-white transition-colors"
                title="Help & Support"
              >
                <HelpCircle className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('toggleKeyboardShortcuts'))}
                className="flex items-center justify-center h-8 rounded-md hover:bg-white/5 text-white/40 hover:text-white transition-colors"
                title="Keyboard Shortcuts (?)"
                aria-label="Keyboard Shortcuts"
              >
                <Keyboard className="h-4 w-4" />
              </button>
              <Link
                href="/settings"
                className="flex items-center justify-center h-8 rounded-md hover:bg-white/5 text-white/40 hover:text-white transition-colors"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
              <Link
                href="/auth/signout"
                className="flex items-center justify-center h-8 rounded-md hover:bg-rose-500/10 text-white/40 hover:text-rose-400 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </Link>
            </div>
          )}

          {/* Collapsed Sign Out */}
          {isDesktopCollapsed && (
            <div className="mt-2 flex flex-col gap-1 items-center">
              <div className="h-px w-4 bg-white/10 my-1" />
              <Link
                href="/auth/signout"
                className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-rose-500/10 text-white/40 hover:text-rose-400 transition-colors"
                title="Sign Out"
              >
                <LogOut className="h-4 w-4" />
              </Link>
            </div>
          )}

          {/* Footer Metadata */}
          {!isDesktopCollapsed && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
              <span className="text-xs text-white/20 font-medium hover:text-white/40 transition-colors cursor-default">
                opsknight.com
              </span>
              <span className="text-xs text-white/10 font-mono">{APP_VERSION}</span>
            </div>
          )}
        </div>

        {/* Edge Collapse Toggle - Sleek vertical handle */}
        {!isMobile && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isDesktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'absolute top-1/2 -translate-y-1/2 z-30',
              'flex items-center justify-center',
              'transition-all duration-300 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900',
              // Positioning - at the right edge
              isDesktopCollapsed ? '-right-[14px]' : '-right-[11px]',
              // Size and shape - vertical pill
              'w-[18px] h-14 rounded-full',
              // Colors and effects
              'bg-gradient-to-b from-slate-700/95 to-slate-800/95 backdrop-blur-md',
              'border border-white/10',
              'shadow-[0_2px_10px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]',
              // Hover state
              'hover:w-[22px] hover:from-slate-600/95 hover:to-slate-700/95',
              'hover:border-white/20',
              'hover:shadow-[0_4px_16px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)]',
              // Active state
              'active:scale-[0.97]',
              // Group for icon animation
              'group'
            )}
          >
            {/* Chevron icon with resonance */}
            <span className="transition-all duration-200 group-hover:scale-110 animate-[pulse-subtle_2s_ease-in-out_infinite]">
              {isDesktopCollapsed ? (
                <ChevronsRight className="h-3.5 w-3.5 text-white/70 group-hover:text-white stroke-[2.5] transition-colors duration-200" />
              ) : (
                <ChevronsLeft className="h-3.5 w-3.5 text-white/70 group-hover:text-white stroke-[2.5] transition-colors duration-200" />
              )}
            </span>
            {/* Resonance ring */}
            <span
              className="absolute inset-0 rounded-full border border-white/20 animate-ping opacity-20 pointer-events-none"
              style={{ animationDuration: '2.5s' }}
            />
            {/* Top shine */}
            <span className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-gradient-to-b from-white/[0.07] to-transparent pointer-events-none" />
          </button>
        )}
      </aside>
    </>
  );
}

interface MobileMenuProps {
  isMobile: boolean;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}

const MobileMenuButton = ({ isMobile, isMobileMenuOpen, setIsMobileMenuOpen }: MobileMenuProps) => (
  <Button
    onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
    className={cn(
      'fixed left-4 top-4 z-[1001] h-11 w-11 rounded-lg shadow-lg',
      'bg-primary text-white',
      'transition-transform hover:scale-[1.02] active:scale-[0.98]',
      isMobile ? 'flex' : 'hidden'
    )}
    aria-label="Toggle navigation menu"
    aria-expanded={isMobileMenuOpen}
    size="icon"
  >
    {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
  </Button>
);

const MobileBackdrop = ({ isMobile, isMobileMenuOpen, setIsMobileMenuOpen }: MobileMenuProps) =>
  isMobile && isMobileMenuOpen ? (
    <div
      className="fixed inset-0 z-[999] bg-black/50 backdrop-blur-sm"
      onClick={() => setIsMobileMenuOpen(false)}
      aria-hidden="true"
    />
  ) : null;
