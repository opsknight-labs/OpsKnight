'use client';

import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';

export type ImpactMetrics = {
  usersAffected?: number;
  downtimeMinutes?: number;
  errorRate?: number;
  servicesAffected?: string[];
  slaBreaches?: number;
  revenueImpact?: number;
  apiErrors?: number;
  performanceDegradation?: number;
};

interface PostmortemImpactInputProps {
  metrics: ImpactMetrics;
  onChange: (metrics: ImpactMetrics) => void;
}

export default function PostmortemImpactInput({ metrics, onChange }: PostmortemImpactInputProps) {
  const updateMetric = (key: keyof ImpactMetrics, value: any) => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    onChange({ ...metrics, [key]: value });
  };

  const updateServicesAffected = (value: string) => {
    const services = value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    updateMetric('servicesAffected', services);
  };

  return (
    <Card className="bg-gradient-to-br from-white to-slate-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Impact Assessment</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Users Affected</Label>
            <Input
              type="number"
              placeholder="0"
              value={metrics.usersAffected?.toString() || ''}
              onChange={e =>
                updateMetric('usersAffected', e.target.value ? parseInt(e.target.value) : undefined)
              }
            />
            <p className="text-xs text-muted-foreground">Number of users impacted</p>
          </div>
          <div className="space-y-1.5">
            <Label>Downtime (minutes)</Label>
            <Input
              type="number"
              placeholder="0"
              value={metrics.downtimeMinutes?.toString() || ''}
              onChange={e =>
                updateMetric(
                  'downtimeMinutes',
                  e.target.value ? parseInt(e.target.value) : undefined
                )
              }
            />
            <p className="text-xs text-muted-foreground">Total downtime duration</p>
          </div>
          <div className="space-y-1.5">
            <Label>Error Rate (%)</Label>
            <Input
              type="number"
              placeholder="0"
              step="0.1"
              value={metrics.errorRate?.toString() || ''}
              onChange={e =>
                updateMetric('errorRate', e.target.value ? parseFloat(e.target.value) : undefined)
              }
            />
            <p className="text-xs text-muted-foreground">Peak error rate percentage</p>
          </div>
          <div className="space-y-1.5">
            <Label>API Errors</Label>
            <Input
              type="number"
              placeholder="0"
              value={metrics.apiErrors?.toString() || ''}
              onChange={e =>
                updateMetric('apiErrors', e.target.value ? parseInt(e.target.value) : undefined)
              }
            />
            <p className="text-xs text-muted-foreground">Total API errors during incident</p>
          </div>
          <div className="space-y-1.5">
            <Label>SLA Breaches</Label>
            <Input
              type="number"
              placeholder="0"
              value={metrics.slaBreaches?.toString() || ''}
              onChange={e =>
                updateMetric('slaBreaches', e.target.value ? parseInt(e.target.value) : undefined)
              }
            />
            <p className="text-xs text-muted-foreground">Number of SLA violations</p>
          </div>
          <div className="space-y-1.5">
            <Label>Performance Degradation (%)</Label>
            <Input
              type="number"
              placeholder="0"
              step="0.1"
              value={metrics.performanceDegradation?.toString() || ''}
              onChange={e =>
                updateMetric(
                  'performanceDegradation',
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
            />
            <p className="text-xs text-muted-foreground">Performance impact percentage</p>
          </div>
          <div className="space-y-1.5">
            <Label>Revenue Impact ($)</Label>
            <Input
              type="number"
              placeholder="0"
              step="0.01"
              value={metrics.revenueImpact?.toString() || ''}
              onChange={e =>
                updateMetric(
                  'revenueImpact',
                  e.target.value ? parseFloat(e.target.value) : undefined
                )
              }
            />
            <p className="text-xs text-muted-foreground">Estimated revenue impact (optional)</p>
          </div>
          <div className="space-y-1.5">
            <Label>Services Affected</Label>
            <Input
              placeholder="Service 1, Service 2, Service 3"
              value={metrics.servicesAffected?.join(', ') || ''}
              onChange={e => updateServicesAffected(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated list of affected services
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
