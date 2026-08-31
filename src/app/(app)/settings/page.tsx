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
import {
  User,
  Settings,
  Shield,
  Building2,
  Puzzle,
  Bell,
  ArrowRight,
  Lock,
  type LucideIcon,
} from 'lucide-react';

const sectionIcons: Record<string, LucideIcon> = {
  account: User,
  workspace: Building2,
  integrations: Puzzle,
  advanced: Settings,
};

const itemIcons: Record<string, LucideIcon> = {
  profile: User,
  preferences: Settings,
  security: Shield,
  'api-keys': Lock,
  'notifications-admin': Bell,
};

import SettingsSearch from '@/components/settings/SettingsSearch';
import '@/styles/pages/settings.css';

export default async function SettingsOverviewPage() {
  const permissions = await getUserPermissions();

  const canAccess = (item: {
    requiresAdmin?: boolean;
    requiresAdminOrAuditor?: boolean;
    requiresResponder?: boolean;
  }) => {
    if (item.requiresAdmin && !permissions.isAdmin) return false;
    if (item.requiresAdminOrAuditor && !permissions.isAdmin && !permissions.isAuditor) return false;
    if (item.requiresResponder && !permissions.isResponderOrAbove) return false;
    return true;
  };

  const sectionGroups = SETTINGS_NAV_SECTIONS.filter(section => section.id !== 'overview');
  const accessibleItems = SETTINGS_NAV_ITEMS.filter(canAccess);
  const popularLinks = accessibleItems.filter(item =>
    ['profile', 'preferences', 'security', 'api-keys', 'notifications-admin'].includes(item.id)
  );

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-lg">
          Manage your account, workspace configuration, and integrations in one place.
        </p>
      </div>

      {/* Search Section */}
      <Card className="border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl">Search Settings</CardTitle>
          <CardDescription>Quickly jump to the page you need</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingsSearch items={accessibleItems} placeholder="Search settings, integrations..." />

          {/* Quick Links */}
          {popularLinks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">Quick Access</h3>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {popularLinks.map(item => {
                  const Icon = itemIcons[item.id] || Settings;

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-accent hover:shadow-md transition-all duration-200 group"
                    >
                      <Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{item.label}</p>
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings Categories */}
      {sectionGroups.map(section => {
        const visibleItems = section.items.filter(canAccess);
        if (visibleItems.length === 0) return null;

        const SectionIcon = sectionIcons[section.id] || Settings;

        return (
          <Card key={section.id} className="border-border bg-card shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <SectionIcon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">{section.label}</CardTitle>
                  <CardDescription>
                    Quick access to frequently used configuration areas
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visibleItems.map(item => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="group relative p-4 rounded-lg border border-border bg-background hover:bg-accent hover:shadow-md hover:border-primary/20 transition-all duration-200"
                  >
                    <div className="space-y-2">
                      <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                        {item.label}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {item.description}
                      </p>
                    </div>
                    <ArrowRight className="absolute top-4 right-4 h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
