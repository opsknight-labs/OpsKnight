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
  ListTodo,
  FileClock,
  ClipboardList,
  BarChart,
  LucideIcon,
} from 'lucide-react';

export type NavSectionKey = 'MAIN' | 'RELIABILITY' | 'ON_CALL' | 'ANALYTICS' | 'GOVERNANCE';

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
  RELIABILITY: {
    key: 'RELIABILITY',
    label: 'Reliability',
    dotClass: 'bg-green-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
  ON_CALL: {
    key: 'ON_CALL',
    label: 'On-Call',
    dotClass: 'bg-blue-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
  ANALYTICS: {
    key: 'ANALYTICS',
    label: 'Analytics',
    dotClass: 'bg-cyan-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
  GOVERNANCE: {
    key: 'GOVERNANCE',
    label: 'Governance',
    dotClass: 'bg-amber-500/80',
    textClass: 'text-slate-400 dark:text-slate-400',
  },
};

export function getNavSectionConfig(key: NavSectionKey): NavSectionConfig {
  switch (key) {
    case 'RELIABILITY':
      return NAV_SECTIONS.RELIABILITY;
    case 'ON_CALL':
      return NAV_SECTIONS.ON_CALL;
    case 'ANALYTICS':
      return NAV_SECTIONS.ANALYTICS;
    case 'GOVERNANCE':
      return NAV_SECTIONS.GOVERNANCE;
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
  // ── MAIN ──────────────────────────────────────────────────────────────────
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

  // ── RELIABILITY ───────────────────────────────────────────────────────────
  // Status Pages are rendered dynamically by Sidebar (conditional on enabled pages)
  {
    href: '/postmortems',
    label: 'Postmortems',
    icon: FileWarning,
    section: 'RELIABILITY',
  },
  {
    href: '/action-items',
    label: 'Action Items',
    icon: ListTodo,
    section: 'RELIABILITY',
  },

  // ── ON-CALL ──────────────────────────────────────────────────────────────
  {
    href: '/schedules',
    label: 'Schedules',
    icon: Calendar,
    section: 'ON_CALL',
  },
  {
    href: '/policies',
    label: 'Escalation Policies',
    icon: ShieldAlert,
    section: 'ON_CALL',
    requiresRole: ['ADMIN', 'RESPONDER', 'AUDITOR'],
  },
  {
    href: '/teams',
    label: 'Teams',
    icon: Users,
    section: 'ON_CALL',
  },
  {
    href: '/users',
    label: 'Users',
    icon: User,
    section: 'ON_CALL',
    requiresRole: ['ADMIN', 'RESPONDER', 'AUDITOR'],
  },

  // ── ANALYTICS ─────────────────────────────────────────────────────────────
  {
    href: '/analytics',
    label: 'Analytics',
    icon: PieChart,
    section: 'ANALYTICS',
  },
  {
    href: '/reports',
    label: 'Reports & Dashboards',
    icon: BarChart,
    section: 'ANALYTICS',
  },

  // ── GOVERNANCE ────────────────────────────────────────────────────────────
  {
    href: '/audit',
    label: 'Audit Log',
    icon: ClipboardList,
    section: 'GOVERNANCE',
    requiresRole: ['ADMIN', 'AUDITOR'],
  },
  {
    href: '/events',
    label: 'Event Logs',
    icon: FileClock,
    section: 'GOVERNANCE',
    requiresRole: ['ADMIN'],
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
    RELIABILITY: [],
    ON_CALL: [],
    ANALYTICS: [],
    GOVERNANCE: [],
  };

  for (const item of items) {
    if (groups[item.section]) {
      groups[item.section].push(item);
    }
  }

  return groups;
}
