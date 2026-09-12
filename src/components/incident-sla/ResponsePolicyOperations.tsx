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
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const asTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const asMinute = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
};

export default function ResponsePolicyOperations({
  services,
  integrations,
  supportVersion,
  supportTimezone,
  supportMode,
  supportWindows,
  supportExceptions,
  schedulerMode,
  schedulerIndexReady,
  schedulerMissingHints = 0,
  schedulerDue = 0,
  schedulerShadowCleanChecks = 0,
  schedulerShadowMismatches = 0,
  supportScopeKey = 'workspace',
  showOperations = true,
}: {
  services: Item[];
  integrations: Item[];
  supportVersion: number;
  supportTimezone: string;
  supportMode: 'INHERIT' | 'ALWAYS' | 'SCHEDULED';
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
  schedulerMissingHints?: number;
  schedulerDue?: number;
  schedulerShadowCleanChecks?: number;
  schedulerShadowMismatches?: number;
  supportScopeKey?: string;
  showOperations?: boolean;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [integrationId, setIntegrationId] = useState('none');
  const [severity, setSeverity] = useState('critical');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [timezone, setTimezone] = useState(supportTimezone);
  const [hoursMode, setHoursMode] = useState(supportMode);
  const [windows, setWindows] = useState(supportWindows);
  const [exceptions, setExceptions] = useState(supportExceptions);
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
        scopeKey: supportScopeKey,
        expectedVersion: version,
        timezone,
        inheritWorkspace: hoursMode === 'INHERIT',
        mode: hoursMode,
        windows: hoursMode === 'SCHEDULED' ? windows : [],
        exceptions: hoursMode === 'SCHEDULED' ? exceptions : [],
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
      {showOperations && (
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
      )}
      {showOperations && (
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
            <p className="text-xs text-muted-foreground">
              Shadow certification: {schedulerShadowCleanChecks} clean checks ·{' '}
              {schedulerShadowMismatches} mismatches in latest check
            </p>
            <p className="text-xs text-muted-foreground">
              Missing hints: {schedulerMissingHints} · Due transitions: {schedulerDue}
            </p>
            <Button
              disabled={pending || selectedSchedulerMode === schedulerMode}
              onClick={saveSchedulerMode}
            >
              Change mode
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            {supportScopeKey === 'workspace' ? 'Workspace' : 'Service'} support hours
          </CardTitle>
          <CardDescription>
            Configure staffed windows and date exceptions. Support hours control engagement only and
            never pause SLA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={hoursMode}
            onValueChange={value => setHoursMode(value as typeof hoursMode)}
          >
            <SelectTrigger aria-label="Support-hours mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {supportScopeKey !== 'workspace' && (
                <SelectItem value="INHERIT">Inherit workspace</SelectItem>
              )}
              <SelectItem value="ALWAYS">24×7</SelectItem>
              <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            </SelectContent>
          </Select>
          <Input
            aria-label="Support-hours timezone"
            value={timezone}
            onChange={event => setTimezone(event.target.value)}
            placeholder="Asia/Kolkata"
          />
          {hoursMode === 'SCHEDULED' && (
            <div className="space-y-3">
              {DAYS.map((day, dayOfWeek) => {
                const dayWindows = windows.filter(window => window.dayOfWeek === dayOfWeek);
                return (
                  <div key={day} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold">{day}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setWindows(current => [
                            ...current,
                            { dayOfWeek, startMinute: 540, endMinute: 1080 },
                          ])
                        }
                      >
                        Add window
                      </Button>
                    </div>
                    {dayWindows.length === 0 && (
                      <p className="text-xs text-muted-foreground">Not staffed</p>
                    )}
                    {dayWindows.map(window => {
                      const absoluteIndex = windows.indexOf(window);
                      return (
                        <div
                          key={`${dayOfWeek}-${absoluteIndex}`}
                          className="mb-2 flex items-center gap-2"
                        >
                          <Input
                            type="time"
                            aria-label={`${day} start`}
                            value={asTime(window.startMinute)}
                            onChange={event =>
                              setWindows(current =>
                                current.map((item, index) =>
                                  index === absoluteIndex
                                    ? { ...item, startMinute: asMinute(event.target.value) }
                                    : item
                                )
                              )
                            }
                          />
                          <span>–</span>
                          <Input
                            type="time"
                            aria-label={`${day} end`}
                            disabled={window.endMinute === 1440}
                            value={window.endMinute === 1440 ? '' : asTime(window.endMinute)}
                            onChange={event =>
                              setWindows(current =>
                                current.map((item, index) =>
                                  index === absoluteIndex
                                    ? { ...item, endMinute: asMinute(event.target.value) }
                                    : item
                                )
                              )
                            }
                          />
                          <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                            <input
                              type="checkbox"
                              checked={window.endMinute === 1440}
                              onChange={event =>
                                setWindows(current =>
                                  current.map((item, index) =>
                                    index === absoluteIndex
                                      ? { ...item, endMinute: event.target.checked ? 1440 : 1080 }
                                      : item
                                  )
                                )
                              }
                            />
                            End of day
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              setWindows(current =>
                                current.filter((_, index) => index !== absoluteIndex)
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">Exceptions</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setExceptions(current => [
                        ...current,
                        {
                          localDate: new Date().toISOString().slice(0, 10),
                          available: false,
                          startMinute: null,
                          endMinute: null,
                          label: null,
                        },
                      ])
                    }
                  >
                    Add exception
                  </Button>
                </div>
                {exceptions.map((exception, index) => (
                  <div
                    key={`${exception.localDate}-${index}`}
                    className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                  >
                    <Input
                      type="date"
                      aria-label={`Exception ${index + 1} date`}
                      value={exception.localDate}
                      onChange={event =>
                        setExceptions(current =>
                          current.map((item, candidate) =>
                            candidate === index ? { ...item, localDate: event.target.value } : item
                          )
                        )
                      }
                    />
                    <Select
                      value={exception.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                      onValueChange={value =>
                        setExceptions(current =>
                          current.map((item, candidate) =>
                            candidate === index
                              ? {
                                  ...item,
                                  available: value === 'AVAILABLE',
                                  startMinute:
                                    value === 'AVAILABLE' ? (item.startMinute ?? 540) : null,
                                  endMinute:
                                    value === 'AVAILABLE' ? (item.endMinute ?? 1080) : null,
                                }
                              : item
                          )
                        )
                      }
                    >
                      <SelectTrigger aria-label={`Exception ${index + 1} availability`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNAVAILABLE">Unavailable</SelectItem>
                        <SelectItem value="AVAILABLE">Special coverage</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      disabled={!exception.available}
                      value={exception.startMinute === null ? '' : asTime(exception.startMinute)}
                      onChange={event =>
                        setExceptions(current =>
                          current.map((item, candidate) =>
                            candidate === index
                              ? { ...item, startMinute: asMinute(event.target.value) }
                              : item
                          )
                        )
                      }
                    />
                    <Input
                      type="time"
                      disabled={!exception.available || exception.endMinute === 1440}
                      value={
                        exception.endMinute === null || exception.endMinute === 1440
                          ? ''
                          : asTime(exception.endMinute)
                      }
                      onChange={event =>
                        setExceptions(current =>
                          current.map((item, candidate) =>
                            candidate === index
                              ? { ...item, endMinute: asMinute(event.target.value) }
                              : item
                          )
                        )
                      }
                    />
                    <label className="flex items-center gap-1 whitespace-nowrap text-xs">
                      <input
                        type="checkbox"
                        disabled={!exception.available}
                        checked={exception.endMinute === 1440}
                        onChange={event =>
                          setExceptions(current =>
                            current.map((item, candidate) =>
                              candidate === index
                                ? { ...item, endMinute: event.target.checked ? 1440 : 1080 }
                                : item
                            )
                          )
                        }
                      />
                      End of day
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setExceptions(current =>
                          current.filter((_, candidate) => candidate !== index)
                        )
                      }
                    >
                      Remove
                    </Button>
                    <Input
                      className="md:col-span-4"
                      placeholder="Label (optional)"
                      value={exception.label ?? ''}
                      onChange={event =>
                        setExceptions(current =>
                          current.map((item, candidate) =>
                            candidate === index
                              ? { ...item, label: event.target.value || null }
                              : item
                          )
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <Button disabled={pending} onClick={saveHours}>
            Save support hours · v{version + 1}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
