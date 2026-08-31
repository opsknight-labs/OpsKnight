import { getUserPermissions } from '@/lib/rbac';
import Link from 'next/link';
import { SETTINGS_NAV_SECTIONS, SETTINGS_NAV_ITEMS } from '@/components/settings/navConfig';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import SettingsSearch from '@/components/settings/SettingsSearch';
import {
  User,
  Settings,
  Shield,
  Building2,
  Puzzle,
  Bell,
  ArrowRight,
  Lock,
  Globe,
  Sliders,
  Activity,
  MessageSquare,
  KeyRound,
  SlidersHorizontal,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const iconMap: Record<string, typeof User> = {
  user: User,
  shield: Shield,
  list: SlidersHorizontal,
  globe: Globe,
  activity: Activity,
  settings: Settings,
  bell: Bell,
  plug: Puzzle,
  slack: MessageSquare,
  'message-circle': MessageSquare,
  key: KeyRound,
};

const pillarGradients: Record<string, { iconBg: string; iconColor: string; border: string }> = {
  account: {
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    border: 'hover:border-blue-200',
  },
  workspace: {
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    border: 'hover:border-emerald-200',
  },
  integrations: {
    iconBg: 'bg-purple-50',
    iconColor: 'text-purple-600',
    border: 'hover:border-purple-200',
  },
  system: {
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    border: 'hover:border-amber-200',
  },
};

export default async function SettingsOverviewPage() {
  const permissions = await getUserPermissions();

  const canAccess = (item: { requiresAdmin?: boolean; requiresResponder?: boolean }) => {
    if (item.requiresAdmin && !permissions.isAdmin) return false;
    if (item.requiresResponder && !permissions.isResponderOrAbove) return false;
    return true;
  };

  const sectionGroups = SETTINGS_NAV_SECTIONS.filter(section => section.id !== 'overview');
  const accessibleItems = SETTINGS_NAV_ITEMS.filter(canAccess);

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Header */}
      <Card className="bg-gradient-to-br from-white to-slate-50 border-slate-200 shadow-sm overflow-hidden relative">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[radial-gradient(circle,rgba(211,47,47,0.04)_0%,transparent_70%)] rounded-full translate-x-[25%] -translate-y-[25%] pointer-events-none" />

        <CardContent className="p-6 md:p-8 relative z-10">
          <div className="max-w-3xl space-y-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary border border-primary/20">
                <Settings className="h-3.5 w-3.5" />
                <span>Workspace Hub</span>
              </span>
              {permissions.isAdmin && (
                <Badge
                  variant="outline"
                  className="text-xs bg-white text-slate-700 border-slate-200"
                >
                  <Shield className="h-3 w-3 mr-1 text-primary" />
                  Administrator
                </Badge>
              )}
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight leading-tight">
              Settings & Workspace Controls
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Configure personal delivery preferences, manage incident metadata, connect alert
              integrations, and monitor platform health in one centralized hub.
            </p>

            <div className="pt-3 max-w-xl">
              <SettingsSearch items={accessibleItems} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Categorized Settings Pillars */}
      <div className="space-y-6">
        {sectionGroups.map(section => {
          const visibleItems = section.items.filter(canAccess);
          if (visibleItems.length === 0) return null;

          const styling = pillarGradients[section.id] || {
            iconBg: 'bg-slate-50',
            iconColor: 'text-slate-600',
            border: 'hover:border-slate-300',
          };

          return (
            <div key={section.id} className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-foreground">{section.label}</h2>
                  {section.description && (
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  )}
                </div>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {visibleItems.map(item => {
                  const Icon = iconMap[item.icon] || Settings;

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className={cn(
                        'group p-4 rounded-xl border border-slate-200/80 bg-white hover:shadow-md transition-all duration-200 flex flex-col justify-between',
                        styling.border
                      )}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-2.5">
                          <div
                            className={cn(
                              'p-2 rounded-lg transition-transform group-hover:scale-105',
                              styling.iconBg
                            )}
                          >
                            <Icon className={cn('h-4 w-4', styling.iconColor)} />
                          </div>
                          {item.badge && (
                            <Badge
                              variant="outline"
                              className="text-[10px] font-semibold px-1.5 py-0 h-4 border-slate-200 text-slate-600"
                            >
                              {item.badge}
                            </Badge>
                          )}
                        </div>

                        <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                          <span>{item.label}</span>
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-2">
                          {item.description}
                        </p>
                      </div>

                      <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between text-xs font-medium text-slate-500 group-hover:text-primary transition-colors">
                        <span>Manage</span>
                        <ChevronRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
