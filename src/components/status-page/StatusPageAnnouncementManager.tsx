'use client';

import React, { useState, useMemo, useTransition } from 'react';
import {
  Megaphone,
  Bell,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Sparkles,
  Info,
  Layers,
  Search,
  X,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, FormField } from '@/components/ui';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import { formatDateTime } from '@/lib/timezone';
import { notify } from '@/lib/toast';
import { getUserFacingErrorMessage } from '@/lib/user-facing-error';

export const ANNOUNCEMENT_TYPES = [
  { value: 'INCIDENT', label: 'Incident', color: '#ef4444', background: '#fee2e2' },
  { value: 'MAINTENANCE', label: 'Maintenance', color: '#2563eb', background: '#dbeafe' },
  { value: 'UPDATE', label: 'Update', color: '#10b981', background: '#dcfce7' },
  { value: 'WARNING', label: 'Warning', color: '#f59e0b', background: '#fef3c7' },
  { value: 'INFO', label: 'Information', color: '#64748b', background: '#f1f5f9' },
];

export interface AnnouncementItem {
  id: string;
  title: string;
  message: string;
  type: string;
  startDate: string | Date;
  endDate?: string | Date | null;
  isActive: boolean;
  affectedServiceIds?: string[] | any;
  createdAt?: string | Date;
}

interface StatusPageAnnouncementManagerProps {
  statusPageId: string;
  announcements: AnnouncementItem[];
  setAnnouncements: React.Dispatch<React.SetStateAction<any[]>>;
  allServices: Array<{ id: string; name: string; region?: string | null }>;
  browserTimeZone: string;
}

function getNext15MinuteTime(d: Date = new Date()): string {
  const coeff = 1000 * 60 * 15;
  const rounded = new Date(Math.ceil(d.getTime() / coeff) * coeff);
  const hh = String(rounded.getHours()).padStart(2, '0');
  const mm = String(rounded.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalInputsToDate(dateStr: string, timeStr?: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [year, month, day] = parts;

  if (timeStr && timeStr.trim()) {
    const timeParts = timeStr.trim().split(':').map(Number);
    if (timeParts.length >= 2 && !timeParts.slice(0, 2).some(isNaN)) {
      const [hours, minutes] = timeParts;
      return new Date(year, month - 1, day, hours, minutes, 0, 0);
    }
  }

  // Default to midnight local
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function formatDuration(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return '';
  const totalMinutes = Math.round(diffMs / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  const chunks: string[] = [];
  if (days > 0) chunks.push(`${days}d`);
  if (hours > 0) chunks.push(`${hours}h`);
  if (minutes > 0 || chunks.length === 0) chunks.push(`${minutes}m`);
  return chunks.join(' ');
}

export default function StatusPageAnnouncementManager({
  statusPageId,
  announcements,
  setAnnouncements,
  allServices,
  browserTimeZone,
}: StatusPageAnnouncementManagerProps) {
  const [isPending, startTransition] = useTransition();
  const [announcementError, setAnnouncementError] = useState<string | null>(null);

  // Form State
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState('INFO');
  const [specifyTime, setSpecifyTime] = useState(true);

  const [startDate, setStartDate] = useState(getLocalDateString());
  const [startTime, setStartTime] = useState(getNext15MinuteTime());

  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  const [isActive, setIsActive] = useState(true);
  const [notifySubscribers, setNotifySubscribers] = useState(true);
  const [affectedServiceIds, setAffectedServiceIds] = useState<string[]>([]);

  // Search & Filter for existing announcements
  const [searchQuery, setSearchQuery] = useState('');

  // Validate start and end date/time
  const parsedStartDate = useMemo(() => {
    return parseLocalInputsToDate(startDate, specifyTime ? startTime : undefined);
  }, [startDate, startTime, specifyTime]);

  const parsedEndDate = useMemo(() => {
    if (!endDate) return null;
    return parseLocalInputsToDate(endDate, specifyTime ? endTime || '23:59' : undefined);
  }, [endDate, endTime, specifyTime]);

  const timeValidationError = useMemo(() => {
    if (!parsedStartDate) {
      return 'Start date is required.';
    }
    if (parsedEndDate && parsedStartDate) {
      if (parsedEndDate.getTime() <= parsedStartDate.getTime()) {
        return 'End date and time must be after start date and time.';
      }
    }
    return null;
  }, [parsedStartDate, parsedEndDate]);

  const calculatedDuration = useMemo(() => {
    if (parsedStartDate && parsedEndDate && parsedEndDate > parsedStartDate) {
      return formatDuration(parsedStartDate, parsedEndDate);
    }
    return null;
  }, [parsedStartDate, parsedEndDate]);

  // Quick Time Adjusters
  const handleSetStartNow = () => {
    const now = new Date();
    setStartDate(getLocalDateString(now));
    setStartTime(
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    );
  };

  const handleAddDuration = (hoursToAdd: number) => {
    const baseStart = parsedStartDate || new Date();
    const end = new Date(baseStart.getTime() + hoursToAdd * 60 * 60 * 1000);
    setEndDate(getLocalDateString(end));
    setEndTime(
      `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`
    );
  };

  const handleClearEnd = () => {
    setEndDate('');
    setEndTime('');
  };

  const handleServiceToggle = (serviceId: string) => {
    setAffectedServiceIds(prev =>
      prev.includes(serviceId) ? prev.filter(id => id !== serviceId) : [...prev, serviceId]
    );
  };

  const handleSelectAllServices = () => {
    setAffectedServiceIds(allServices.map(s => s.id));
  };

  const handleClearAllServices = () => {
    setAffectedServiceIds([]);
  };

  const handleCreate = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    setAnnouncementError(null);

    const trimmedTitle = title.trim();
    const trimmedMessage = message.trim();

    if (!trimmedTitle || !trimmedMessage) {
      setAnnouncementError('Title and message are required.');
      return;
    }

    if (timeValidationError) {
      setAnnouncementError(timeValidationError);
      return;
    }

    if (!parsedStartDate) {
      setAnnouncementError('Invalid start date.');
      return;
    }

    // Convert local dates to ISO strings
    const startIso = parsedStartDate.toISOString();
    const endIso = parsedEndDate ? parsedEndDate.toISOString() : null;

    startTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            statusPageId,
            title: trimmedTitle,
            message: trimmedMessage,
            type,
            startDate: startIso,
            endDate: endIso,
            isActive,
            notifySubscribers,
            affectedServiceIds: affectedServiceIds.length > 0 ? affectedServiceIds : null,
          }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Failed to create announcement');
        }

        if (data?.announcement) {
          setAnnouncements(current => [data.announcement, ...current]);
          notify.success('Announcement published successfully');
        }

        // Reset form
        setTitle('');
        setMessage('');
        setType('INFO');
        setStartDate(getLocalDateString());
        setStartTime(getNext15MinuteTime());
        setEndDate('');
        setEndTime('');
        setAffectedServiceIds([]);
        setIsActive(true);
        setNotifySubscribers(true);
      } catch (err) {
        setAnnouncementError(getUserFacingErrorMessage(err) || 'Failed to create announcement');
      }
    });
  };

  const handleDelete = (id: string) => {
    setAnnouncementError(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/settings/status-page/announcements', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ statusPageId, id }),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Failed to delete announcement');
        }

        setAnnouncements(current => current.filter(item => item.id !== id));
        notify.success('Announcement deleted');
      } catch (err) {
        setAnnouncementError(getUserFacingErrorMessage(err) || 'Failed to delete announcement');
      }
    });
  };

  // Filter existing announcements
  const filteredAnnouncements = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return announcements;
    return announcements.filter(
      a =>
        a.title.toLowerCase().includes(q) ||
        a.message.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q)
    );
  }, [announcements, searchQuery]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* LEFT COLUMN: Create Announcement Form (7 cols) */}
      <div className="lg:col-span-7">
        <StatusPageSectionCard
          title="Create Announcement"
          description="Publish scheduled maintenance, incidents, or update notices with exact start and end times."
          icon={<Megaphone className="w-5 h-5 text-primary" />}
        >
          <form onSubmit={handleCreate} className="space-y-4">
            {/* Title */}
            <FormField
              type="input"
              label="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Scheduled Database Maintenance Window"
              required
            />

            {/* Message */}
            <FormField
              type="textarea"
              label="Message"
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Describe the scope, anticipated customer impact, and progress updates..."
              required
            />

            {/* Type & Time Options Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Announcement Type
                </label>
                <select
                  value={type}
                  onChange={e => setType(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                >
                  {ANNOUNCEMENT_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-foreground">
                    Time Precision
                  </label>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1 font-mono">
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    {browserTimeZone}
                  </span>
                </div>

                <div className="inline-flex w-full items-center bg-muted/60 p-1 rounded-lg border border-border/80 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setSpecifyTime(true)}
                    className={cn(
                      'flex-1 py-1.5 rounded-md transition-all text-center font-semibold',
                      specifyTime
                        ? 'bg-background text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    Exact Time
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpecifyTime(false)}
                    className={cn(
                      'flex-1 py-1.5 rounded-md transition-all text-center font-semibold',
                      !specifyTime
                        ? 'bg-background text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    All Day / Date Only
                  </button>
                </div>
              </div>
            </div>

            {/* Date & Time Configuration Card */}
            <div className="p-3.5 rounded-xl border border-border/80 bg-muted/15 space-y-3.5">
              {/* Start Date & Time */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-primary" />
                    Start Date & Time
                  </label>
                  {specifyTime && (
                    <button
                      type="button"
                      onClick={handleSetStartNow}
                      className="text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                    >
                      Set to Now
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className={specifyTime ? 'sm:col-span-7' : 'sm:col-span-12'}>
                    <input
                      type="date"
                      value={startDate}
                      onChange={e => setStartDate(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      required
                    />
                  </div>
                  {specifyTime && (
                    <div className="sm:col-span-5">
                      <input
                        type="time"
                        value={startTime}
                        onChange={e => setStartTime(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* End Date & Time (Optional) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                    End Date & Time{' '}
                    <span className="text-muted-foreground font-normal">(Optional)</span>
                  </label>
                  {endDate && (
                    <button
                      type="button"
                      onClick={handleClearEnd}
                      className="text-[11px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Clear End Time
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className={specifyTime ? 'sm:col-span-7' : 'sm:col-span-12'}>
                    <input
                      type="date"
                      value={endDate}
                      onChange={e => setEndDate(e.target.value)}
                      placeholder="Open-ended"
                      className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  {specifyTime && (
                    <div className="sm:col-span-5">
                      <input
                        type="time"
                        value={endTime}
                        onChange={e => setEndTime(e.target.value)}
                        disabled={!endDate}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                      />
                    </div>
                  )}
                </div>

                {/* Duration Presets */}
                <div className="flex items-center gap-1.5 flex-wrap mt-2 pt-2 border-t border-border/50">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground mr-1">
                    Quick Window:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleAddDuration(1)}
                    className="px-2 py-0.5 text-[11px] font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                  >
                    +1h
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddDuration(2)}
                    className="px-2 py-0.5 text-[11px] font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                  >
                    +2h
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddDuration(4)}
                    className="px-2 py-0.5 text-[11px] font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                  >
                    +4h
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddDuration(24)}
                    className="px-2 py-0.5 text-[11px] font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                  >
                    +24h
                  </button>
                  {endDate && (
                    <button
                      type="button"
                      onClick={handleClearEnd}
                      className="px-2 py-0.5 text-[11px] font-medium bg-muted/60 text-muted-foreground hover:text-foreground rounded-md transition-colors"
                    >
                      Ongoing
                    </button>
                  )}
                </div>
              </div>

              {/* Real-time Duration & Status Calculation */}
              {timeValidationError ? (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{timeValidationError}</span>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs text-muted-foreground bg-background p-2.5 rounded-lg border border-border/70">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    {calculatedDuration ? (
                      <>
                        Window Duration:{' '}
                        <strong className="text-foreground">{calculatedDuration}</strong>
                      </>
                    ) : (
                      <span>Open-ended notice (until manually resolved)</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px]">
                    {parsedStartDate && parsedStartDate.getTime() > Date.now() ? (
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                        ● Scheduled
                      </span>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                        ● Active now
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Affected Services Mapping */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  Affected Services ({affectedServiceIds.length} of {allServices.length})
                </label>
                {allServices.length > 0 && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={handleSelectAllServices}
                      className="text-primary hover:underline font-medium"
                    >
                      Select all
                    </button>
                    <span>•</span>
                    <button
                      type="button"
                      onClick={handleClearAllServices}
                      className="text-muted-foreground hover:text-foreground font-medium"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {allServices.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground text-center">
                  No services available on this status page yet.
                </div>
              ) : (
                <div className="max-h-36 overflow-y-auto border border-border rounded-lg p-2.5 bg-background space-y-1.5">
                  {allServices.map(svc => {
                    const isChecked = affectedServiceIds.includes(svc.id);
                    return (
                      <label
                        key={svc.id}
                        className={cn(
                          'flex items-center justify-between p-1.5 rounded-md text-xs cursor-pointer select-none transition-colors',
                          isChecked
                            ? 'bg-primary/10 text-primary font-semibold'
                            : 'hover:bg-muted/40 text-foreground'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleServiceToggle(svc.id)}
                            className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                          />
                          <span>{svc.name}</span>
                        </div>
                        {svc.region && (
                          <Badge variant="neutral" size="xs" className="font-mono text-[10px]">
                            {svc.region}
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Delivery & Active Checkboxes */}
            <div className="flex items-center gap-5 pt-1 text-xs">
              <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground select-none">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={e => setIsActive(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                />
                <span>Active (published immediately)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer font-medium text-foreground select-none">
                <input
                  type="checkbox"
                  checked={notifySubscribers}
                  onChange={e => setNotifySubscribers(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                />
                <span>Notify Email Subscribers</span>
              </label>
            </div>

            {/* Error Message */}
            {announcementError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                {announcementError}
              </div>
            )}

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                variant="primary"
                isLoading={isPending}
                disabled={Boolean(timeValidationError)}
              >
                Add Announcement
              </Button>
            </div>
          </form>
        </StatusPageSectionCard>
      </div>

      {/* RIGHT COLUMN: Recent Announcements List (5 cols) */}
      <div className="lg:col-span-5">
        <StatusPageSectionCard
          title="Recent Announcements"
          description="Active, scheduled, and past announcements on this status page."
          icon={<Bell className="w-5 h-5 text-primary" />}
          action={
            <Badge variant="secondary" className="font-semibold text-xs">
              {announcements.length} total
            </Badge>
          }
        >
          {/* Search Bar for Announcements */}
          {announcements.length > 3 && (
            <div className="relative mb-3">
              <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                <Search className="w-3.5 h-3.5" />
              </div>
              <input
                type="text"
                placeholder="Filter announcements..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          {filteredAnnouncements.length === 0 ? (
            <div className="py-10 px-4 text-center rounded-xl border border-dashed border-border bg-muted/10">
              <Megaphone className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
              <p className="text-xs text-muted-foreground font-medium">
                {searchQuery
                  ? 'No announcements match your search.'
                  : 'No announcements published yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
              {filteredAnnouncements.map(announcement => {
                const typeConfig =
                  ANNOUNCEMENT_TYPES.find(t => t.value === announcement.type) ||
                  ANNOUNCEMENT_TYPES[4];

                const sDate = new Date(announcement.startDate);
                const eDate = announcement.endDate ? new Date(announcement.endDate) : null;
                const now = new Date();

                const isUpcoming = sDate > now;
                const isEnded = eDate ? eDate < now : false;
                const isOngoing = !isUpcoming && !isEnded && announcement.isActive;

                // Duration calculation if available
                const durationLabel = eDate && eDate > sDate ? formatDuration(sDate, eDate) : null;

                return (
                  <div
                    key={announcement.id}
                    className="p-3.5 rounded-xl border border-border/80 bg-card hover:border-border transition-all shadow-2xs space-y-2.5"
                  >
                    {/* Header Row: Type Badge + Status Pill + Delete */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          style={{
                            background: typeConfig.background,
                            color: typeConfig.color,
                          }}
                          className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase"
                        >
                          {typeConfig.label}
                        </span>

                        {/* Lifecycle Status Pill */}
                        {!announcement.isActive ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                            Draft / Inactive
                          </span>
                        ) : isUpcoming ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            Upcoming
                          </span>
                        ) : isOngoing ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active Now
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/80 text-muted-foreground">
                            Concluded
                          </span>
                        )}

                        {durationLabel && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground bg-muted/40 border border-border/60">
                            {durationLabel}
                          </span>
                        )}
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-red-600"
                        onClick={() => handleDelete(announcement.id)}
                        disabled={isPending}
                        title="Delete Announcement"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Title & Message */}
                    <div>
                      <h4 className="font-bold text-xs text-foreground">{announcement.title}</h4>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap leading-relaxed">
                        {announcement.message}
                      </p>
                    </div>

                    {/* Time Schedule Banner */}
                    <div className="pt-2 border-t border-border/50 text-[11px] text-muted-foreground space-y-1">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                        <span>
                          <strong className="text-foreground">Start:</strong>{' '}
                          {formatDateTime(announcement.startDate, browserTimeZone, {
                            format: 'datetime',
                            includeTimeZone: true,
                          })}
                        </span>
                      </div>

                      {announcement.endDate && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span>
                            <strong className="text-foreground">End:</strong>{' '}
                            {formatDateTime(announcement.endDate, browserTimeZone, {
                              format: 'datetime',
                              includeTimeZone: true,
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </StatusPageSectionCard>
      </div>
    </div>
  );
}
