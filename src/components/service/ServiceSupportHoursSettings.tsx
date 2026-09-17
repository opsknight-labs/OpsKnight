'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Badge } from '@/components/ui/shadcn/badge';
import { saveSupportHoursPolicyAction } from '@/app/(app)/settings/incident-sla/actions';
import { notify } from '@/lib/toast';
import { Calendar, Globe, Building2, Plus, Trash2, Check, Loader2, Info, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

type SupportMode = 'INHERIT' | 'ALWAYS' | 'SCHEDULED';

type SupportWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

type SupportException = {
  localDate: string;
  available: boolean;
  startMinute: number | null;
  endMinute: number | null;
  label: string | null;
};

interface ServiceSupportHoursSettingsProps {
  serviceId: string;
  policy: {
    version: number;
    timezone: string;
    mode: SupportMode;
    windows: SupportWindow[];
    exceptions: SupportException[];
  } | null;
  canManage: boolean;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const asTime = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const asMinute = (time: string) => {
  const [hour, minute] = time.split(':').map(Number);
  return (hour || 0) * 60 + (minute || 0);
};

export default function ServiceSupportHoursSettings({
  serviceId,
  policy,
  canManage,
}: ServiceSupportHoursSettingsProps) {
  const [version, setVersion] = useState(policy?.version ?? 0);
  const [mode, setMode] = useState<SupportMode>(policy?.mode ?? 'INHERIT');
  const [timezone, setTimezone] = useState(policy?.timezone ?? 'UTC');
  const [windows, setWindows] = useState<SupportWindow[]>(policy?.windows ?? []);
  const [exceptions, setExceptions] = useState<SupportException[]>(policy?.exceptions ?? []);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    startTransition(async () => {
      try {
        const result = await saveSupportHoursPolicyAction({
          scopeKey: `service:${serviceId}`,
          expectedVersion: version,
          timezone,
          mode,
          windows,
          exceptions: exceptions.map(item => ({
            localDate: item.localDate,
            available: item.available,
            startMinute: item.available ? (item.startMinute ?? 540) : null,
            endMinute: item.available ? (item.endMinute ?? 1080) : null,
            label: item.label,
          })),
        });

        if (!result.ok) {
          notify.error(result.message);
          return;
        }

        setVersion(result.version);
        notify.success('Service support hours saved successfully.');
      } catch {
        notify.error('Unable to save service support hours.');
      }
    });
  };

  const addPresetBusinessHours = () => {
    // Mon-Fri 9:00 - 17:00 (540 - 1020)
    const newWindows: SupportWindow[] = [];
    for (let day = 1; day <= 5; day++) {
      newWindows.push({ dayOfWeek: day, startMinute: 540, endMinute: 1020 });
    }
    setWindows(newWindows);
  };

  return (
    <div className="space-y-6">
      {/* Information notice */}
      <div className="rounded-xl border border-border/80 bg-muted/20 p-3.5 flex items-start gap-2.5 shadow-2xs">
        <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          Support hours control active responder engagement windows and notification policies.
          Support hours define when staff are expected on-deck and never pause running SLA
          countdowns.
        </p>
      </div>

      {/* Coverage Mode Cards */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-foreground">Operational Coverage Mode</span>
          <Badge variant="outline" className="text-[10px] font-mono">
            v{version}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Inherit Workspace */}
          <button
            type="button"
            disabled={!canManage || pending}
            onClick={() => setMode('INHERIT')}
            className={cn(
              'flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer relative',
              'disabled:cursor-not-allowed disabled:opacity-60',
              mode === 'INHERIT'
                ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20 shadow-2xs text-foreground'
                : 'border-border/80 bg-card hover:bg-muted/40 hover:border-border text-foreground shadow-2xs'
            )}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Inherit Workspace
                </span>
                {mode === 'INHERIT' && (
                  <div className="h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                    <Check className="h-2.5 w-2.5" />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                Adopts the organization-wide support calendar and holiday policies automatically.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-border/40 text-[10px] font-medium text-primary">
              Global Default
            </div>
          </button>

          {/* 24x7 Always Active */}
          <button
            type="button"
            disabled={!canManage || pending}
            onClick={() => setMode('ALWAYS')}
            className={cn(
              'flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer relative',
              'disabled:cursor-not-allowed disabled:opacity-60',
              mode === 'ALWAYS'
                ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/20 shadow-2xs text-foreground'
                : 'border-border/80 bg-card hover:bg-muted/40 hover:border-border text-foreground shadow-2xs'
            )}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Sun className="h-3.5 w-3.5 text-emerald-500" />
                  24×7 Continuous
                </span>
                {mode === 'ALWAYS' && (
                  <div className="h-4 w-4 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Check className="h-2.5 w-2.5" />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                Active coverage 24 hours a day, 7 days a week. Ideal for mission-critical core
                services.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-border/40 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Round-the-clock
            </div>
          </button>

          {/* Scheduled Hours */}
          <button
            type="button"
            disabled={!canManage || pending}
            onClick={() => setMode('SCHEDULED')}
            className={cn(
              'flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer relative',
              'disabled:cursor-not-allowed disabled:opacity-60',
              mode === 'SCHEDULED'
                ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/20 shadow-2xs text-foreground'
                : 'border-border/80 bg-card hover:bg-muted/40 hover:border-border text-foreground shadow-2xs'
            )}
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-amber-500" />
                  Custom Schedule
                </span>
                {mode === 'SCHEDULED' && (
                  <div className="h-4 w-4 rounded-full bg-amber-600 text-white flex items-center justify-center shrink-0">
                    <Check className="h-2.5 w-2.5" />
                  </div>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-medium leading-relaxed">
                Define specific operating windows per day of the week, with date-based holiday
                exceptions.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-border/40 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Staffed Rotations
            </div>
          </button>
        </div>
      </div>

      {/* Timezone Configuration */}
      <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="support-timezone"
            className="text-xs font-semibold text-foreground flex items-center gap-1.5"
          >
            <Globe className="h-3.5 w-3.5 text-primary" />
            Support Operating Timezone
          </label>
          <span className="text-[10px] font-mono text-muted-foreground">Current: {timezone}</span>
        </div>
        <Input
          id="support-timezone"
          aria-label="Support-hours timezone"
          value={timezone}
          disabled={!canManage || pending}
          onChange={e => setTimezone(e.target.value)}
          placeholder="e.g. America/New_York, UTC, Asia/Kolkata, Europe/London"
          className="text-xs h-9 font-mono"
        />
      </div>

      {/* Weekly Schedule Editor (when SCHEDULED) */}
      {mode === 'SCHEDULED' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <span className="text-xs font-bold text-foreground block">
                Weekly Operating Windows
              </span>
              <p className="text-[11px] text-muted-foreground">
                Define the hours during which this service is actively staffed by responders.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canManage || pending}
              onClick={addPresetBusinessHours}
              className="text-xs h-7 px-2.5 font-medium self-start sm:self-auto"
            >
              Apply M-F 9-5 Preset
            </Button>
          </div>

          <div className="space-y-2.5">
            {DAYS.map((day, dayOfWeek) => {
              const dayWindows = windows.filter(window => window.dayOfWeek === dayOfWeek);
              const isStaffed = dayWindows.length > 0;

              return (
                <div
                  key={day}
                  className={cn(
                    'rounded-xl border p-3.5 transition-all shadow-2xs',
                    isStaffed
                      ? 'border-border/80 bg-card'
                      : 'border-border/50 bg-muted/15 opacity-80'
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-foreground">{day}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[9px] font-medium px-1.5 py-0',
                          isStaffed
                            ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                            : 'bg-muted text-muted-foreground border-border'
                        )}
                      >
                        {isStaffed ? `${dayWindows.length} window` : 'Not staffed'}
                      </Badge>
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!canManage || pending}
                      onClick={() =>
                        setWindows(current => [
                          ...current,
                          { dayOfWeek, startMinute: 540, endMinute: 1020 },
                        ])
                      }
                      className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-primary/10"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add window
                    </Button>
                  </div>

                  {dayWindows.length > 0 && (
                    <div className="space-y-2 pt-1 border-t border-border/40">
                      {dayWindows.map(window => {
                        const absoluteIndex = windows.indexOf(window);
                        return (
                          <div
                            key={`${dayOfWeek}-${absoluteIndex}`}
                            className="flex flex-wrap items-center gap-2 text-xs"
                          >
                            <Input
                              type="time"
                              aria-label={`${day} start`}
                              disabled={!canManage || pending}
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
                              className="h-8 w-28 text-xs font-mono"
                            />
                            <span className="text-muted-foreground font-mono">–</span>
                            <Input
                              type="time"
                              aria-label={`${day} end`}
                              disabled={!canManage || pending || window.endMinute === 1440}
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
                              className="h-8 w-28 text-xs font-mono"
                            />

                            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground cursor-pointer select-none">
                              <input
                                type="checkbox"
                                disabled={!canManage || pending}
                                checked={window.endMinute === 1440}
                                onChange={event =>
                                  setWindows(current =>
                                    current.map((item, index) =>
                                      index === absoluteIndex
                                        ? { ...item, endMinute: event.target.checked ? 1440 : 1020 }
                                        : item
                                    )
                                  )
                                }
                                className="h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary/20"
                              />
                              End of day (24:00)
                            </label>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!canManage || pending}
                              onClick={() =>
                                setWindows(current =>
                                  current.filter((_, index) => index !== absoluteIndex)
                                )
                              }
                              className="h-7 text-xs px-2 text-destructive hover:bg-destructive/10 ml-auto"
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Remove
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Exceptions Editor */}
          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-foreground block">
                  Calendar Exceptions & Holidays
                </span>
                <p className="text-[11px] text-muted-foreground">
                  Override weekly schedule for specific calendar dates.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage || pending}
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
                className="h-7 text-xs px-2.5 font-medium"
              >
                <Plus className="mr-1 h-3 w-3" />
                Add exception
              </Button>
            </div>

            {exceptions.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">
                No calendar exceptions configured. Weekly schedule applies to all dates.
              </p>
            ) : (
              <div className="space-y-2 pt-2 border-t border-border/40">
                {exceptions.map((exception, index) => (
                  <div
                    key={`${exception.localDate}-${index}`}
                    className="p-3 rounded-lg border border-border/60 bg-muted/20 space-y-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="date"
                        aria-label={`Exception ${index + 1} date`}
                        disabled={!canManage || pending}
                        value={exception.localDate}
                        onChange={event =>
                          setExceptions(current =>
                            current.map((item, candidate) =>
                              candidate === index
                                ? { ...item, localDate: event.target.value }
                                : item
                            )
                          )
                        }
                        className="h-8 w-36 text-xs font-mono"
                      />

                      <select
                        aria-label={`Exception ${index + 1} availability`}
                        disabled={!canManage || pending}
                        value={exception.available ? 'AVAILABLE' : 'UNAVAILABLE'}
                        onChange={e => {
                          const isAvail = e.target.value === 'AVAILABLE';
                          setExceptions(current =>
                            current.map((item, candidate) =>
                              candidate === index
                                ? {
                                    ...item,
                                    available: isAvail,
                                    startMinute: isAvail ? (item.startMinute ?? 540) : null,
                                    endMinute: isAvail ? (item.endMinute ?? 1020) : null,
                                  }
                                : item
                            )
                          );
                        }}
                        className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs"
                      >
                        <option value="UNAVAILABLE">Unavailable (Holiday)</option>
                        <option value="AVAILABLE">Special Coverage</option>
                      </select>

                      {exception.available && (
                        <>
                          <Input
                            type="time"
                            disabled={!canManage || pending}
                            value={
                              exception.startMinute === null ? '' : asTime(exception.startMinute)
                            }
                            onChange={event =>
                              setExceptions(current =>
                                current.map((item, candidate) =>
                                  candidate === index
                                    ? { ...item, startMinute: asMinute(event.target.value) }
                                    : item
                                )
                              )
                            }
                            className="h-8 w-24 text-xs font-mono"
                          />
                          <span>–</span>
                          <Input
                            type="time"
                            disabled={!canManage || pending || exception.endMinute === 1440}
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
                            className="h-8 w-24 text-xs font-mono"
                          />
                        </>
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!canManage || pending}
                        onClick={() =>
                          setExceptions(current =>
                            current.filter((_, candidate) => candidate !== index)
                          )
                        }
                        className="h-7 text-xs px-2 text-destructive hover:bg-destructive/10 ml-auto"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    <Input
                      placeholder="Exception description / holiday label (optional)"
                      disabled={!canManage || pending}
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
                      className="h-8 text-xs bg-background"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Footer */}
      {canManage && (
        <div className="flex items-center justify-between pt-3 border-t border-border/50">
          <p className="text-[11px] text-muted-foreground">
            Changes apply to routing and escalations immediately upon save.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={handleSave}
            className="h-8 px-4 text-xs font-semibold shadow-2xs"
          >
            {pending ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              `Save support hours · v${version + 1}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
