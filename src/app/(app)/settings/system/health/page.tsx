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
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const statusConfig: Record<
  HealthLevel,
  { label: string; badgeClass: string; icon: typeof Activity; borderClass: string }
> = {
  healthy: {
    label: 'Healthy',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    borderClass: 'border-emerald-200/60',
    icon: CheckCircle2,
  },
  degraded: {
    label: 'Needs Attention',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    borderClass: 'border-amber-200/60',
    icon: AlertTriangle,
  },
  unhealthy: {
    label: 'Action Required',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200',
    borderClass: 'border-rose-200/60',
    icon: XCircle,
  },
  unknown: {
    label: 'Not Reported',
    badgeClass: 'bg-slate-50 text-slate-700 border-slate-200',
    borderClass: 'border-slate-200',
    icon: CircleHelp,
  },
};

export default async function AdminHealthCenterPage() {
  await assertAdmin();
  const report = await collectAdminHealth();
  const overall = statusConfig[report.overall];
  const OverallIcon = overall.icon;

  const healthyCount = report.checks.filter(c => c.status === 'healthy').length;
  const degradedCount = report.checks.filter(c => c.status === 'degraded').length;
  const unhealthyCount = report.checks.filter(c => c.status === 'unhealthy').length;

  return (
    <div className="space-y-6 pb-12">
      <SettingsPageHeader
        title="System Health & Diagnostics Center"
        description="Comprehensive operational diagnostic signals across PostgreSQL, background job workers, Redis queue, and integrations."
        backHref="/settings"
        backLabel="Back to Settings"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/system/health">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Re-run Diagnostics
            </Link>
          </Button>
        }
      />

      {/* Overview Metric Summary */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Overall Status
            </span>
            <OverallIcon
              className={cn(
                'h-4 w-4',
                report.overall === 'healthy'
                  ? 'text-emerald-600'
                  : report.overall === 'degraded'
                    ? 'text-amber-600'
                    : 'text-rose-600'
              )}
            />
          </div>
          <div className="mt-2 text-xl font-bold text-foreground capitalize">{overall.label}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Verified {new Date(report.generatedAt).toLocaleTimeString()}
          </p>
        </Card>

        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Healthy Signals
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">
            {healthyCount} / {report.checks.length}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Operating normally</p>
        </Card>

        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Warnings
            </span>
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{degradedCount}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">Sub-optimal latency or retries</p>
        </Card>

        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Critical Attention
            </span>
            <XCircle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 text-xl font-bold text-foreground">{unhealthyCount}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Requires administrator intervention
          </p>
        </Card>
      </div>

      {/* Diagnostics Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {report.checks.map(check => {
          const config = statusConfig[check.status];
          const Icon = config.icon;

          return (
            <Card
              key={check.id}
              className={cn(
                'border bg-white shadow-xs hover:shadow-md transition-all duration-150 flex flex-col justify-between overflow-hidden',
                config.borderClass
              )}
            >
              <div>
                <CardHeader className="p-4 pb-3 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-md bg-slate-100 text-slate-700">
                        <Icon className="h-4 w-4" />
                      </div>
                      <CardTitle className="text-sm font-bold text-foreground">
                        {check.label}
                      </CardTitle>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] font-semibold px-2 py-0.5', config.badgeClass)}
                    >
                      {config.label}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs text-foreground font-medium pt-1">
                    {check.summary}
                  </CardDescription>
                </CardHeader>

                <CardContent className="p-4 space-y-3">
                  <ul className="space-y-1.5 text-xs text-muted-foreground">
                    {check.details.map((detail, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
                        <span className="leading-relaxed break-words">{detail}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </div>

              {check.action && (
                <div className="p-4 pt-0">
                  <Button variant="outline" size="sm" className="w-full text-xs h-8" asChild>
                    <Link href={check.action.href}>{check.action.label}</Link>
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
