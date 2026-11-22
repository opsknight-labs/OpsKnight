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
  Workflow,
  Boxes,
  MonitorCheck,
  Sparkles,
  BellRing,
  GitCommitHorizontal,
  Network,
  Gauge,
  LucideIcon,
} from 'lucide-react';
import { getRoleCapabilities, isAppRole, type Capability } from '@/lib/authorization';
import { canAccessPath } from '@/lib/access/pages';

export type NavSectionKey =
  'MAIN' | 'RESPOND' | 'CATALOG' | 'STATUS' | 'ON_CALL' | 'LEARN' | 'INSIGHTS' | 'ORGANIZATION';

export interface NavSectionConfig {
  key: NavSectionKey;
  label?: string;
  dotClass?: string;
}

/** Sidebar groups in display order, by job: respond, know the estate, communicate, learn. */
export const NAV_SECTION_ORDER: readonly NavSectionKey[] = [
  'MAIN',
  'RESPOND',
  'CATALOG',
  'STATUS',
  'ON_CALL',
  'LEARN',
  'INSIGHTS',
  'ORGANIZATION',
];

export function getNavSectionConfig(key: NavSectionKey): NavSectionConfig {
  switch (key) {
    case 'RESPOND':
      return { key, label: 'Respond', dotClass: 'bg-rose-500/80' };
    case 'CATALOG':
      return { key, label: 'Catalog', dotClass: 'bg-violet-500/80' };
    case 'STATUS':
      return { key, label: 'Status', dotClass: 'bg-emerald-500/80' };
    case 'ON_CALL':
      return { key, label: 'On-call', dotClass: 'bg-blue-500/80' };
    case 'LEARN':
      return { key, label: 'Learn', dotClass: 'bg-orange-500/80' };
    case 'INSIGHTS':
      return { key, label: 'Insights', dotClass: 'bg-cyan-500/80' };
    case 'ORGANIZATION':
      return { key, label: 'Organization', dotClass: 'bg-amber-500/80' };
    case 'MAIN':
    default:
      return { key: 'MAIN' };
  }
}

export interface NavItemConfig {
  href: string;
  label: string;
  icon: LucideIcon;
  section: NavSectionKey;
  shortcut?: string;
  badgeKey?: 'incidents';
  releaseStage?: 'Beta';
  /** The page is built around incidents and sends people without incident read elsewhere. */
  needsIncidentRead?: true;
}

export const NAVIGATION_ITEMS: readonly NavItemConfig[] = [
  {
    href: '/',
    needsIncidentRead: true,
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

  // Alerts, Changes: shown by their page access rule (intelligence.read), like every entry.
  { href: '/alerts', label: 'Alerts', icon: BellRing, section: 'RESPOND' },
  { href: '/changes', label: 'Changes', icon: GitCommitHorizontal, section: 'RESPOND' },
  {
    href: '/runbooks',
    label: 'Runbooks',
    releaseStage: 'Beta',
    icon: Workflow,
    section: 'RESPOND',
  },

  {
    href: '/services',
    needsIncidentRead: true,
    label: 'Services',
    icon: Server,
    section: 'CATALOG',
  },
  { href: '/services/business', label: 'Business services', icon: Boxes, section: 'CATALOG' },
  { href: '/services/graph', label: 'Service graph', icon: Network, section: 'CATALOG' },

  // Open to every signed-in person (stakeholders included); the page filters what they see.
  // Public status pages are added to this group by Sidebar when any are enabled.
  { href: '/status-dashboard', label: 'Status dashboard', icon: MonitorCheck, section: 'STATUS' },

  { href: '/schedules', label: 'Schedules', icon: Calendar, section: 'ON_CALL' },
  { href: '/policies', label: 'Escalation policies', icon: ShieldAlert, section: 'ON_CALL' },

  { href: '/postmortems', label: 'Postmortems', icon: FileWarning, section: 'LEARN' },
  {
    href: '/action-items',
    needsIncidentRead: true,
    label: 'Action items',
    icon: ListTodo,
    section: 'LEARN',
  },

  // Pinned by tests/unit/intelligence-overview.test.ts.
  { href: '/intelligence', label: 'Intelligence', icon: Sparkles, section: 'INSIGHTS' },
  { href: '/insights', label: 'Analytics', icon: PieChart, section: 'INSIGHTS' },
  { href: '/insights/business-impact', label: 'Business impact', icon: Gauge, section: 'INSIGHTS' },
  { href: '/reports', label: 'Reports', icon: BarChart, section: 'INSIGHTS' },

  { href: '/teams', needsIncidentRead: true, label: 'Teams', icon: Users, section: 'ORGANIZATION' },
  { href: '/users', label: 'Users', icon: User, section: 'ORGANIZATION' },
  { href: '/audit', label: 'Audit log', icon: ClipboardList, section: 'ORGANIZATION' },
  { href: '/events', label: 'Event logs', icon: FileClock, section: 'ORGANIZATION' },
] as const;

/**
 * Items the person may open. Visibility comes from the shared page access registry, so the
 * menu always matches what the server enforces. Accepts effective capabilities (preferred) or a
 * built-in role.
 */
export function getAuthorizedNavItems(
  access?: readonly Capability[] | string | null
): NavItemConfig[] {
  if (!access) return [];
  const capabilities =
    typeof access === 'string' ? (isAppRole(access) ? getRoleCapabilities(access) : []) : access;
  // Stakeholders (no incident read) would only be redirected from these, so they are hidden.
  const readsIncidents = canAccessPath('/incidents', capabilities);
  return NAVIGATION_ITEMS.filter(
    item => canAccessPath(item.href, capabilities) && (readsIncidents || !item.needsIncidentRead)
  );
}

/** Group authorized items by their navigation section. */
export function groupNavItemsBySection(
  items: NavItemConfig[]
): Map<NavSectionKey, NavItemConfig[]> {
  const groups = new Map<NavSectionKey, NavItemConfig[]>(NAV_SECTION_ORDER.map(key => [key, []]));
  for (const item of items) groups.get(item.section)?.push(item);
  return groups;
}
