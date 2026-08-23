import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { assertAdmin } from '@/lib/rbac';
import { collectAdminHealth, type HealthLevel } from '@/lib/admin-health';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const statusConfig: Record<
  HealthLevel,
  { label: string; badge: 'success' | 'warning' | 'danger' | 'neutral'; icon: typeof Activity }
> = {
  healthy: { label: 'Healthy', badge: 'success', icon: CheckCircle2 },
  degraded: { label: 'Needs attention', badge: 'warning', icon: AlertTriangle },
  unhealthy: { label: 'Action required', badge: 'danger', icon: XCircle },
  unknown: { label: 'Not reported', badge: 'neutral', icon: CircleHelp },
};

export default async function AdminHealthCenterPage() {
  await assertAdmin();
  const report = await collectAdminHealth();
  const overall = statusConfig[report.overall];
  const OverallIcon = overall.icon;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Administrator Health Center"
        description="One operational view of the signals OpsKnight can verify from this instance."
        backHref="/settings/system"
        backLabel="Back to System Settings"
      />

      <Alert variant={report.overall === 'unhealthy' ? 'destructive' : 'default'}>
        <OverallIcon className="h-4 w-4" />
        <AlertTitle>Overall status: {overall.label}</AlertTitle>
        <AlertDescription>
          Generated {new Date(report.generatedAt).toLocaleString()}. Unknown is intentionally not
          treated as healthy. Confirm external backup, provider, cluster, and database telemetry
          before declaring the installation healthy.
        </AlertDescription>
      </Alert>

      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          This page exposes status and counts, never credentials, connection strings, or key
          material.
        </p>
        <Button variant="outline" asChild>
          <Link href="/settings/system/health">
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {report.checks.map(check => {
          const config = statusConfig[check.status];
          const Icon = config.icon;
          return (
            <Card key={check.id} className="h-full">
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-lg">{check.label}</CardTitle>
                  </div>
                  <Badge variant={config.badge}>{config.label}</Badge>
                </div>
                <p className="text-sm font-medium leading-6">{check.summary}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {check.details.map(detail => (
                    <li key={detail} className="flex gap-2">
                      <span aria-hidden="true">•</span>
                      <span className="break-words">{detail}</span>
                    </li>
                  ))}
                </ul>
                {check.action && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={check.action.href}>{check.action.label}</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
