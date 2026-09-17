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
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import {
  FlaskConical,
  Cpu,
  CalendarClock,
  Activity,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';

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
    <div className="grid gap-6 lg:grid-cols-2">
      {showOperations && (
        <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 border border-amber-500/20 shadow-2xs">
                  <FlaskConical className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">Effective Policy Simulation</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    Simulate classification, SLA targets, and support coverage for any service and
                    severity.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Target Service</label>
                <Select
                  value={serviceId}
                  onValueChange={value => {
                    setServiceId(value);
                    setIntegrationId('none');
                  }}
                >
                  <SelectTrigger aria-label="Preview service" className="h-9 text-xs">
                    <SelectValue placeholder="Select service" />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map(item => (
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Integration Override
                </label>
                <Select value={integrationId} onValueChange={setIntegrationId}>
                  <SelectTrigger aria-label="Preview integration" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      No integration override
                    </SelectItem>
                    {eligible.map(item => (
                      <SelectItem key={item.id} value={item.id} className="text-xs">
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Alert Severity</label>
                <Select value={severity} onValueChange={setSeverity}>
                  <SelectTrigger aria-label="Preview severity" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['critical', 'error', 'warning', 'info'].map(value => (
                      <SelectItem key={value} value={value} className="text-xs capitalize">
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                size="sm"
                disabled={pending || !serviceId}
                onClick={runPreview}
                className="h-8 px-4 text-xs font-semibold shadow-2xs gap-1.5"
              >
                {pending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FlaskConical className="h-3.5 w-3.5" />
                )}
                Run simulation
              </Button>

              {preview && (
                <div className="space-y-2.5 rounded-xl border border-border/80 bg-muted/20 p-3.5 text-xs shadow-2xs mt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      Resolution Preview
                    </span>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {preview.sla.source}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                        Resolved Priority
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant="outline"
                          className="text-xs font-bold bg-primary/10 text-primary border-primary/20"
                        >
                          {preview.priority.value ?? 'None'}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground truncate">
                          ({preview.priority.scope ?? preview.priority.source})
                        </span>
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-background/60 border border-border/40">
                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                        Notification Urgency
                      </span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge
                          variant="outline"
                          className="text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                        >
                          {preview.urgency.value}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground truncate">
                          ({preview.urgency.scope ?? preview.urgency.source})
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-background/60 border border-border/40 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Target SLA Clocks:</span>
                      <span className="font-bold text-foreground">
                        {Math.round(preview.sla.ackTargetMs / 60000)}m ACK ·{' '}
                        {Math.round(preview.sla.resolveTargetMs / 60000)}m Resolve
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">Support & Engagement:</span>
                      <span className="font-medium text-foreground">
                        {preview.supportHours.state} · {preview.engagement.reason}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </div>
        </Card>
      )}

      {showOperations && (
        <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0 border border-emerald-500/20 shadow-2xs">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold">SLA Scheduler Engine</CardTitle>
                  <CardDescription className="mt-0.5 text-xs">
                    Multi-replica scheduler rollout and real-time transition diagnostics.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Active Scheduler Mode
                </label>
                <Select
                  value={selectedSchedulerMode}
                  onValueChange={value =>
                    setSelectedSchedulerMode(value as 'LEGACY' | 'SHADOW' | 'INDEXED')
                  }
                >
                  <SelectTrigger aria-label="SLA scheduler mode" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LEGACY" className="text-xs">
                      Legacy (Poll-Based)
                    </SelectItem>
                    <SelectItem value="SHADOW" className="text-xs">
                      Shadow (Dual Verification)
                    </SelectItem>
                    <SelectItem value="INDEXED" disabled={!schedulerIndexReady} className="text-xs">
                      Indexed (Production Optimized)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Diagnostic Metric Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                <div className="p-2.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Online Index
                  </span>
                  <span className="font-bold flex items-center gap-1.5 text-foreground">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        schedulerIndexReady ? 'bg-emerald-500' : 'bg-amber-500'
                      )}
                    />
                    {schedulerIndexReady ? 'Ready & Active' : 'Not Installed'}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Shadow Audit
                  </span>
                  <span className="font-bold text-foreground truncate">
                    {schedulerShadowCleanChecks} clean · {schedulerShadowMismatches} mismatch
                  </span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Missing Hints
                  </span>
                  <span className="font-bold text-foreground">{schedulerMissingHints}</span>
                </div>
                <div className="p-2.5 rounded-xl border border-border/60 bg-muted/20 flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                    Due Transitions
                  </span>
                  <span className="font-bold text-foreground">{schedulerDue}</span>
                </div>
              </div>

              <div className="pt-2">
                <Button
                  size="sm"
                  disabled={pending || selectedSchedulerMode === schedulerMode}
                  onClick={saveSchedulerMode}
                  className="h-8 px-4 text-xs font-semibold shadow-2xs gap-1.5"
                >
                  {pending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Activity className="h-3.5 w-3.5" />
                  )}
                  Change scheduler mode
                </Button>
              </div>
            </CardContent>
          </div>
        </Card>
      )}
      <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs lg:col-span-2">
        <CardHeader className="border-b border-border/60 bg-muted/20 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0 border border-indigo-500/20 shadow-2xs">
                <CalendarClock className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold">
                  {supportScopeKey === 'workspace' ? 'Workspace' : 'Service'} Support Hours &
                  Operations
                </CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  Configure staffed windows and date exceptions. Support hours control responder
                  engagement only and never pause incident SLA clocks.
                </CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">
              v{version}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Coverage Mode</label>
              <Select
                value={hoursMode}
                onValueChange={value => setHoursMode(value as typeof hoursMode)}
              >
                <SelectTrigger aria-label="Support-hours mode" className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportScopeKey !== 'workspace' && (
                    <SelectItem value="INHERIT" className="text-xs">
                      Inherit workspace schedule
                    </SelectItem>
                  )}
                  <SelectItem value="ALWAYS" className="text-xs">
                    24×7 Continuous Coverage
                  </SelectItem>
                  <SelectItem value="SCHEDULED" className="text-xs">
                    Custom Scheduled Windows
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Operational Timezone</label>
              <Input
                aria-label="Support-hours timezone"
                value={timezone}
                onChange={event => setTimezone(event.target.value)}
                placeholder="Asia/Kolkata or UTC"
                className="h-9 text-xs"
              />
            </div>
          </div>

          {hoursMode === 'SCHEDULED' && (
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-xs font-bold text-foreground">Weekly Staffed Windows</span>
                <span className="text-[11px] text-muted-foreground">
                  Times in {timezone || 'UTC'}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {DAYS.map((day, dayOfWeek) => {
                  const dayWindows = windows.filter(window => window.dayOfWeek === dayOfWeek);
                  return (
                    <div
                      key={day}
                      className="rounded-xl border border-border/70 bg-muted/10 p-3.5 space-y-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">{day}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px] font-medium gap-1 shadow-2xs"
                          onClick={() =>
                            setWindows(current => [
                              ...current,
                              { dayOfWeek, startMinute: 540, endMinute: 1080 },
                            ])
                          }
                        >
                          <Plus className="h-3 w-3" />
                          Add window
                        </Button>
                      </div>
                      {dayWindows.length === 0 && (
                        <p className="text-[11px] text-muted-foreground italic">
                          Not staffed (Unstaffed off-hours)
                        </p>
                      )}
                      {dayWindows.map(window => {
                        const absoluteIndex = windows.indexOf(window);
                        return (
                          <div
                            key={`${dayOfWeek}-${absoluteIndex}`}
                            className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-background border border-border/60 text-xs"
                          >
                            <Input
                              type="time"
                              aria-label={`${day} start`}
                              value={asTime(window.startMinute)}
                              className="h-7 w-24 text-xs px-2"
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
                            <span className="text-muted-foreground">–</span>
                            <Input
                              type="time"
                              aria-label={`${day} end`}
                              disabled={window.endMinute === 1440}
                              value={window.endMinute === 1440 ? '' : asTime(window.endMinute)}
                              className="h-7 w-24 text-xs px-2"
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
                            <label className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground cursor-pointer">
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
                                className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/20"
                              />
                              End of day
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-500 ml-auto"
                              onClick={() =>
                                setWindows(current =>
                                  current.filter((_, index) => index !== absoluteIndex)
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>

              {/* Exceptions Section */}
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4 mt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-foreground">
                      Date Exceptions & Holidays
                    </span>
                    <p className="text-[11px] text-muted-foreground">
                      Override staffing for specific calendar dates
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs font-semibold gap-1 shadow-2xs"
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
                    <Plus className="h-3.5 w-3.5" />
                    Add exception
                  </Button>
                </div>

                {exceptions.length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-2">
                    No calendar exceptions configured.
                  </p>
                )}

                {exceptions.map((exception, index) => (
                  <div
                    key={`${exception.localDate}-${index}`}
                    className="grid gap-2 p-3 rounded-lg bg-background border border-border/60 md:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]"
                  >
                    <Input
                      type="date"
                      aria-label={`Exception ${index + 1} date`}
                      value={exception.localDate}
                      className="h-8 text-xs"
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
                      <SelectTrigger
                        aria-label={`Exception ${index + 1} availability`}
                        className="h-8 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UNAVAILABLE" className="text-xs">
                          Unavailable (Holiday)
                        </SelectItem>
                        <SelectItem value="AVAILABLE" className="text-xs">
                          Special Coverage
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="time"
                      disabled={!exception.available}
                      value={exception.startMinute === null ? '' : asTime(exception.startMinute)}
                      className="h-8 text-xs"
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
                    <div className="flex items-center gap-2">
                      <Input
                        type="time"
                        disabled={!exception.available || exception.endMinute === 1440}
                        value={
                          exception.endMinute === null || exception.endMinute === 1440
                            ? ''
                            : asTime(exception.endMinute)
                        }
                        className="h-8 text-xs flex-1"
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
                      <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
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
                          className="h-3.5 w-3.5 rounded border-border text-primary"
                        />
                        EOD
                      </label>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500"
                      onClick={() =>
                        setExceptions(current =>
                          current.filter((_, candidate) => candidate !== index)
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Input
                      className="h-8 text-xs md:col-span-5"
                      placeholder="Label (e.g., Regional Public Holiday, Maintenance Window)"
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

          <div className="pt-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={saveHours}
              className="h-8 px-4 text-xs font-semibold shadow-2xs gap-1.5"
            >
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CalendarClock className="h-3.5 w-3.5" />
              )}
              Save support hours · v{version + 1}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
