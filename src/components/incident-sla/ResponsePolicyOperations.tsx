'use client';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Input } from '@/components/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  previewResponsePolicyAction,
  saveSlaSchedulerModeAction,
  saveSupportHoursPolicyAction,
} from '@/app/(app)/settings/incident-sla/actions';
import { notify } from '@/lib/toast';

type Item = { id: string; name: string; serviceId?: string };
type Preview = {
  priority: { value: string | null; source: string; scope: string | null };
  urgency: { value: string; source: string; scope: string | null };
  sla: { ackTargetMs: number; resolveTargetMs: number; source: string };
  supportHours: { state: string };
  engagement: { reason: string };
};

export default function ResponsePolicyOperations({
  services,
  integrations,
  supportVersion,
  supportTimezone,
  supportWindows,
  supportExceptions,
  schedulerMode,
  schedulerIndexReady,
}: {
  services: Item[];
  integrations: Item[];
  supportVersion: number;
  supportTimezone: string;
  supportWindows: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
  supportExceptions: Array<{
    localDate: string;
    available: boolean;
    startMinute: number | null;
    endMinute: number | null;
    label: string | null;
  }>;
  schedulerMode: 'LEGACY' | 'SHADOW' | 'INDEXED';
  schedulerIndexReady: boolean;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [integrationId, setIntegrationId] = useState('none');
  const [severity, setSeverity] = useState('critical');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [timezone, setTimezone] = useState(supportTimezone);
  const [version, setVersion] = useState(supportVersion);
  const [pending, startTransition] = useTransition();
  const [selectedSchedulerMode, setSelectedSchedulerMode] = useState(schedulerMode);
  const eligible = integrations.filter(item => item.serviceId === serviceId);
  const runPreview = () =>
    startTransition(async () => {
      const result = await previewResponsePolicyAction({
        serviceId,
        integrationId: integrationId === 'none' ? null : integrationId,
        severity,
      });
      if (!result.ok) {
        notify.error(result.message);
        return;
      }
      setPreview(result.value as Preview);
    });
  const saveHours = () =>
    startTransition(async () => {
      const result = await saveSupportHoursPolicyAction({
        scopeKey: 'workspace',
        expectedVersion: version,
        timezone,
        inheritWorkspace: false,
        windows: supportWindows,
        exceptions: supportExceptions,
      });
      if (!result.ok) {
        notify.error(result.message);
        return;
      }
      setVersion(result.version);
      notify.success('Support hours saved; SLA clocks remain unchanged.');
    });
  const saveSchedulerMode = () =>
    startTransition(async () => {
      const result = await saveSlaSchedulerModeAction(selectedSchedulerMode);
      if (!result.ok) {
        notify.error(result.message);
        return;
      }
      notify.success(`SLA scheduler changed to ${result.mode.toLowerCase()} mode.`);
    });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Test effective policy</CardTitle>
          <CardDescription>
            Uses the exact production classification, SLA and engagement resolvers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={serviceId}
            onValueChange={value => {
              setServiceId(value);
              setIntegrationId('none');
            }}
          >
            <SelectTrigger aria-label="Preview service">
              <SelectValue placeholder="Service" />
            </SelectTrigger>
            <SelectContent>
              {services.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={integrationId} onValueChange={setIntegrationId}>
            <SelectTrigger aria-label="Preview integration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No integration override</SelectItem>
              {eligible.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger aria-label="Preview severity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['critical', 'error', 'warning', 'info'].map(value => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={pending || !serviceId} onClick={runPreview}>
            Preview
          </Button>
          {preview && (
            <div className="space-y-1 rounded-md border p-3 text-xs">
              <p>
                Priority: <strong>{preview.priority.value ?? 'none'}</strong> from{' '}
                {preview.priority.scope ?? preview.priority.source}
              </p>
              <p>
                Urgency: <strong>{preview.urgency.value}</strong> from{' '}
                {preview.urgency.scope ?? preview.urgency.source}
              </p>
              <p>
                ACK {Math.round(preview.sla.ackTargetMs / 60000)}m · Resolve{' '}
                {Math.round(preview.sla.resolveTargetMs / 60000)}m · {preview.sla.source}
              </p>
              <p>
                Support {preview.supportHours.state} · {preview.engagement.reason}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">SLA scheduler</CardTitle>
          <CardDescription>
            Change rollout mode live across replicas. Indexed mode requires the online index.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={selectedSchedulerMode}
            onValueChange={value =>
              setSelectedSchedulerMode(value as 'LEGACY' | 'SHADOW' | 'INDEXED')
            }
          >
            <SelectTrigger aria-label="SLA scheduler mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LEGACY">Legacy</SelectItem>
              <SelectItem value="SHADOW">Shadow</SelectItem>
              <SelectItem value="INDEXED" disabled={!schedulerIndexReady}>
                Indexed
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Online index: {schedulerIndexReady ? 'ready' : 'not installed'}
          </p>
          <Button
            disabled={pending || selectedSchedulerMode === schedulerMode}
            onClick={saveSchedulerMode}
          >
            Change mode
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Workspace support hours</CardTitle>
          <CardDescription>
            Change the timezone without replacing the configured windows or exceptions. Support
            hours control engagement only and never pause SLA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            aria-label="Support-hours timezone"
            value={timezone}
            onChange={event => setTimezone(event.target.value)}
            placeholder="Asia/Kolkata"
          />
          <Button disabled={pending} onClick={saveHours}>
            Save support hours · v{version + 1}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
