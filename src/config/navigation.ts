import {
  LayoutDashboard,
  AlertTriangle,
  Server,
  Users,
  User,
  Calendar,
  ShieldAlert,
  PieChart,
  FileWarning,
  Activity,
  ListTodo,
  FileClock,
  ClipboardList,
  BarChart,
  LucideIcon,
} from 'lucide-react';

export type NavSectionKey = 'MAIN' | 'OPERATIONS' | 'INSIGHTS';

export interface NavSectionConfig {
  key: NavSectionKey;
  label?: string;
  dotClass?: string;
  textClass?: string;
}

export const NAV_SECTIONS: Record<NavSectionKey, NavSectionConfig> = {
  MAIN: {
    key: 'MAIN',
  },
  OPERATIONS: {
    key: 'OPERATIONS',
    label: 'Operations',
    dotClass: 'bg-blue-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
  INSIGHTS: {
    key: 'INSIGHTS',
    label: 'Insights',
    dotClass: 'bg-purple-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
};

export function getNavSectionConfig(key: NavSectionKey): NavSectionConfig {
  switch (key) {
    case 'OPERATIONS':
      return NAV_SECTIONS.OPERATIONS;
    case 'INSIGHTS':
      return NAV_SECTIONS.INSIGHTS;
    case 'MAIN':
    default:
      return NAV_SECTIONS.MAIN;
  }
}

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSectionKey;
  requiresRole?: string[];
  shortcut?: string;
  badgeKey?: 'incidents';
}

export const NAVIGATION_ITEMS: readonly NavItemConfig[] = [
  // Main
  {
    href: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    section: 'MAIN',
  },
  {
    href: '/incidents',
    label: 'Incidents',
    icon: AlertTriangle,
    section: 'MAIN',
    badgeKey: 'incidents',
  },
  {
    href: '/services',
    label: 'Services',
    icon: Server,
    section: 'MAIN',
  },

  // Operations Section
  {
    href: '/teams',
    label: 'Teams',
    icon: Users,
    section: 'OPERATIONS',
  },
  {
    href: '/users',
    label: 'Users',
    icon: User,
    section: 'OPERATIONS',
  },
  {
    href: '/schedules',
    label: 'Schedules',
    icon: Calendar,
    section: 'OPERATIONS',
  },
  {
    href: '/policies',
    label: 'Escalation Policies',
    icon: ShieldAlert,
    section: 'OPERATIONS',
  },

  // Insights Section
  {
    href: '/analytics',
    label: 'Analytics',
    icon: PieChart,
    section: 'INSIGHTS',
  },
  {
    href: '/postmortems',
    label: 'Postmortems',
    icon: FileWarning,
    section: 'INSIGHTS',
  },
  {
    href: '/status',
    label: 'Status Page',
    icon: Activity,
    section: 'INSIGHTS',
  },
  {
    href: '/action-items',
    label: 'Action Items',
    icon: ListTodo,
    section: 'INSIGHTS',
  },
  {
    href: '/events',
    label: 'Event Logs',
    icon: FileClock,
    section: 'INSIGHTS',
    requiresRole: ['ADMIN'],
  },
  {
    href: '/audit',
    label: 'Audit Log',
    icon: ClipboardList,
    section: 'INSIGHTS',
    requiresRole: ['ADMIN', 'AUDITOR'],
  },
  {
    href: '/reports',
    label: 'Reports & Dashboards',
    icon: BarChart,
    section: 'INSIGHTS',
  },
] as const;

/**
 * Filter navigation items safely according to the user's role.
 */
export function getAuthorizedNavItems(userRole?: string | null): NavItemConfig[] {
  return NAVIGATION_ITEMS.filter(item => {
    if (!item.requiresRole || item.requiresRole.length === 0) return true;
    if (!userRole) return false;
    return item.requiresRole.includes(userRole);
  });
}

/**
 * Group authorized items by their navigation section.
 */
export function groupNavItemsBySection(
  items: NavItemConfig[]
): Record<NavSectionKey, NavItemConfig[]> {
  const groups: Record<NavSectionKey, NavItemConfig[]> = {
    MAIN: [],
    OPERATIONS: [],
    INSIGHTS: [],
  };

  for (const item of items) {
    if (groups[item.section]) {
      groups[item.section].push(item);
    }
  }

  return groups;
}
