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
  Radio,
  History,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, FormField } from '@/components/ui';
import { Badge } from '@/components/ui/shadcn/badge';
import StatusPageSectionCard from '@/components/status-page/StatusPageSectionCard';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
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

type FilterTab = 'all' | 'active' | 'scheduled' | 'concluded' | 'draft';

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

  // Dialog / Modal Composer State
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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

  // Search & Filter Tabs
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  // Service ID map for fast lookup
  const serviceMap = useMemo(() => {
    const map = new Map<string, { id: string; name: string; region?: string | null }>();
    allServices.forEach(s => map.set(s.id, s));
    return map;
  }, [allServices]);

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

  // Compute status counts for metrics bar
  const counts = useMemo(() => {
    const now = new Date();
    let active = 0;
    let scheduled = 0;
    let concluded = 0;
    let draft = 0;

    announcements.forEach(a => {
      if (!a.isActive) {
        draft++;
        return;
      }
      const s = new Date(a.startDate);
      const e = a.endDate ? new Date(a.endDate) : null;
      if (s > now) {
        scheduled++;
      } else if (e && e < now) {
        concluded++;
      } else {
        active++;
      }
    });

    return { total: announcements.length, active, scheduled, concluded, draft };
  }, [announcements]);

  // Filter existing announcements
  const filteredAnnouncements = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const now = new Date();

    return announcements.filter(a => {
      const s = new Date(a.startDate);
      const e = a.endDate ? new Date(a.endDate) : null;
      const isUpcoming = s > now;
      const isEnded = e ? e < now : false;
      const isOngoing = !isUpcoming && !isEnded && a.isActive;

      // Filter Tab
      if (activeTab === 'active' && !isOngoing) return false;
      if (activeTab === 'scheduled' && (!isUpcoming || !a.isActive)) return false;
      if (activeTab === 'concluded' && (!isEnded || !a.isActive)) return false;
      if (activeTab === 'draft' && a.isActive) return false;

      // Search Query
      if (q) {
        const matchesTitle = a.title.toLowerCase().includes(q);
        const matchesMsg = a.message.toLowerCase().includes(q);
        const matchesType = a.type.toLowerCase().includes(q);
        if (!matchesTitle && !matchesMsg && !matchesType) return false;
      }

      return true;
    });
  }, [announcements, searchQuery, activeTab]);

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

  const resetForm = () => {
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
    setAnnouncementError(null);
  };

  const handleOpenCreateModal = () => {
    resetForm();
    setIsCreateOpen(true);
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

        setIsCreateOpen(false);
        resetForm();
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

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Header & Metrics Bar */}
      <StatusPageSectionCard
        title="Status Page Announcements"
        description="Communicate scheduled maintenance windows, active incidents, and service updates to subscribers and visitors."
        icon={<Megaphone className="w-5 h-5 text-primary" />}
        action={
          <Button
            type="button"
            variant="primary"
            onClick={handleOpenCreateModal}
            className="flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>New Announcement</span>
          </Button>
        }
      >
        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div
            onClick={() => setActiveTab('all')}
            className={cn(
              'p-3 rounded-xl border transition-all cursor-pointer select-none',
              activeTab === 'all'
                ? 'bg-primary/10 border-primary shadow-xs'
                : 'bg-card border-border/80 hover:bg-muted/30'
            )}
          >
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
              Total Notices
            </span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xl font-bold text-foreground">{counts.total}</span>
              <Bell className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>

          <div
            onClick={() => setActiveTab('active')}
            className={cn(
              'p-3 rounded-xl border transition-all cursor-pointer select-none',
              activeTab === 'active'
                ? 'bg-emerald-500/10 border-emerald-500 shadow-xs'
                : 'bg-card border-border/80 hover:bg-muted/30'
            )}
          >
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
              Active Now
            </span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {counts.active}
              </span>
              <span className="relative flex h-2.5 w-2.5">
                {counts.active > 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
              </span>
            </div>
          </div>

          <div
            onClick={() => setActiveTab('scheduled')}
            className={cn(
              'p-3 rounded-xl border transition-all cursor-pointer select-none',
              activeTab === 'scheduled'
                ? 'bg-indigo-500/10 border-indigo-500 shadow-xs'
                : 'bg-card border-border/80 hover:bg-muted/30'
            )}
          >
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
              Scheduled
            </span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                {counts.scheduled}
              </span>
              <Clock className="w-4 h-4 text-indigo-500" />
            </div>
          </div>

          <div
            onClick={() => setActiveTab('concluded')}
            className={cn(
              'p-3 rounded-xl border transition-all cursor-pointer select-none',
              activeTab === 'concluded'
                ? 'bg-muted border-border shadow-xs'
                : 'bg-card border-border/80 hover:bg-muted/30'
            )}
          >
            <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
              Concluded
            </span>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xl font-bold text-muted-foreground">{counts.concluded}</span>
              <History className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>

        {/* Filter Tabs & Search Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          {/* Tab Controls */}
          <div className="flex items-center gap-1 overflow-x-auto p-1 bg-muted/50 rounded-lg border border-border/70 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={cn(
                'px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap',
                activeTab === 'all'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All Notices ({counts.total})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={cn(
                'px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
                activeTab === 'active'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Active ({counts.active})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('scheduled')}
              className={cn(
                'px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
                activeTab === 'scheduled'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              Scheduled ({counts.scheduled})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('concluded')}
              className={cn(
                'px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap',
                activeTab === 'concluded'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Concluded ({counts.concluded})
            </button>
            {counts.draft > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('draft')}
                className={cn(
                  'px-3 py-1.5 rounded-md font-medium transition-all whitespace-nowrap',
                  activeTab === 'draft'
                    ? 'bg-background text-foreground shadow-2xs font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Drafts ({counts.draft})
              </button>
            )}
          </div>

          {/* Search Input (No Icon) */}
          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder="Search announcements..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-lg placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </StatusPageSectionCard>

      {/* 2. Full-Width Announcements List */}
      <div className="space-y-3.5">
        {filteredAnnouncements.length === 0 ? (
          <div className="py-14 px-6 text-center rounded-xl border border-dashed border-border/80 bg-card">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-3">
              <Megaphone className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">No announcements found</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
              {searchQuery
                ? `No announcements match the query "${searchQuery}". Try changing your filter or keyword.`
                : activeTab !== 'all'
                  ? `There are currently no announcements in the ${activeTab} view.`
                  : 'Keep your users informed about maintenance schedules, incidents, or upgrades.'}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenCreateModal}
              className="mt-4 gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Announcement
            </Button>
          </div>
        ) : (
          filteredAnnouncements.map(announcement => {
            const typeConfig =
              ANNOUNCEMENT_TYPES.find(t => t.value === announcement.type) || ANNOUNCEMENT_TYPES[4];

            const sDate = new Date(announcement.startDate);
            const eDate = announcement.endDate ? new Date(announcement.endDate) : null;
            const now = new Date();

            const isUpcoming = sDate > now;
            const isEnded = eDate ? eDate < now : false;
            const isOngoing = !isUpcoming && !isEnded && announcement.isActive;

            const durationLabel = eDate && eDate > sDate ? formatDuration(sDate, eDate) : null;

            // Resolve affected service names
            const affectedServices = (announcement.affectedServiceIds || [])
              .map((id: string) => serviceMap.get(id))
              .filter(Boolean);

            return (
              <div
                key={announcement.id}
                className="p-4 sm:p-5 rounded-xl border border-border/80 bg-card hover:border-border transition-all shadow-2xs space-y-3"
              >
                {/* Header: Type Badge, Status Pill, Duration & Delete */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      style={{
                        background: typeConfig.background,
                        color: typeConfig.color,
                      }}
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide uppercase"
                    >
                      {typeConfig.label}
                    </span>

                    {/* Status Pill */}
                    {!announcement.isActive ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted text-muted-foreground">
                        Draft / Inactive
                      </span>
                    ) : isUpcoming ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />
                        Upcoming
                      </span>
                    ) : isOngoing ? (
                      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Active Now
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-muted/80 text-muted-foreground flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-muted-foreground" />
                        Concluded
                      </span>
                    )}

                    {durationLabel && (
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono text-muted-foreground bg-muted/40 border border-border/60 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-muted-foreground" />
                        {durationLabel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 transition-colors"
                      onClick={() => handleDelete(announcement.id)}
                      disabled={isPending}
                      title="Delete Announcement"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      <span className="text-xs">Delete</span>
                    </Button>
                  </div>
                </div>

                {/* Content Section */}
                <div>
                  <h4 className="text-sm sm:text-base font-semibold text-foreground tracking-tight">
                    {announcement.title}
                  </h4>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1.5 whitespace-pre-wrap leading-relaxed">
                    {announcement.message}
                  </p>
                </div>

                {/* Footer Metadata: Schedule Timestamps & Affected Services */}
                <div className="pt-3 border-t border-border/60 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>
                        <strong className="text-foreground">Starts:</strong>{' '}
                        {formatDateTime(announcement.startDate, browserTimeZone, {
                          format: 'datetime',
                          includeTimeZone: true,
                        })}
                      </span>
                    </div>

                    {announcement.endDate && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span>
                          <strong className="text-foreground">Ends:</strong>{' '}
                          {formatDateTime(announcement.endDate, browserTimeZone, {
                            format: 'datetime',
                            includeTimeZone: true,
                          })}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Affected Services Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium text-foreground">Services:</span>
                    {affectedServices.length > 0 ? (
                      affectedServices.slice(0, 4).map((s: any) => (
                        <Badge key={s.id} variant="secondary" size="xs">
                          {s.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground text-[11px] italic">
                        All Services (Global)
                      </span>
                    )}
                    {affectedServices.length > 4 && (
                      <Badge variant="outline" size="xs">
                        +{affectedServices.length - 4} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 3. Dedicated Focused Modal Composer */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-6 overflow-hidden">
          <DialogHeader className="shrink-0 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Megaphone className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold text-foreground">
                  Create Announcement
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  Publish a new incident, scheduled maintenance, or service status announcement.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreate} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto pr-1 space-y-5 py-2">
              {/* Section 1: Notice Info */}
              <div className="space-y-3.5">
                <FormField
                  type="input"
                  label="Title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Scheduled Database Maintenance Window"
                  required
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                <FormField
                  type="textarea"
                  label="Message"
                  rows={3}
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Describe the scope, anticipated customer impact, and mitigation progress..."
                  required
                />
              </div>

              {/* Section 2: Schedule & Timing Window */}
              <div className="p-4 rounded-xl border border-border/80 bg-muted/20 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-primary" />
                    Schedule Window
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    Timezone: <strong className="text-foreground">{browserTimeZone}</strong>
                  </span>
                </div>

                {/* Start Date & Time */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Start Date & Time <span className="text-red-500">*</span>
                    </label>
                    {specifyTime && (
                      <button
                        type="button"
                        onClick={handleSetStartNow}
                        className="text-xs font-semibold text-primary hover:underline cursor-pointer"
                      >
                        Set to Now
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
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

                {/* End Date & Time */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      End Date & Time{' '}
                      <span className="text-muted-foreground font-normal">(Optional)</span>
                    </label>
                    {endDate && (
                      <button
                        type="button"
                        onClick={handleClearEnd}
                        className="text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Clear End Time
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
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
                  <div className="flex items-center gap-1.5 flex-wrap mt-2.5 pt-2.5 border-t border-border/50">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground mr-1">
                      Quick Window:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleAddDuration(1)}
                      className="px-2.5 py-1 text-xs font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                    >
                      +1h
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDuration(2)}
                      className="px-2.5 py-1 text-xs font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                    >
                      +2h
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDuration(4)}
                      className="px-2.5 py-1 text-xs font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                    >
                      +4h
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddDuration(24)}
                      className="px-2.5 py-1 text-xs font-medium bg-background border border-border rounded-md hover:bg-muted text-foreground transition-colors"
                    >
                      +24h
                    </button>
                    {endDate && (
                      <button
                        type="button"
                        onClick={handleClearEnd}
                        className="px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground hover:text-foreground rounded-md transition-colors"
                      >
                        Ongoing / Open-ended
                      </button>
                    )}
                  </div>
                </div>

                {/* Real-time Duration & Status Pill */}
                {timeValidationError ? (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{timeValidationError}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-xs text-muted-foreground bg-background p-3 rounded-lg border border-border/70">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      {calculatedDuration ? (
                        <>
                          Duration:{' '}
                          <strong className="text-foreground">{calculatedDuration}</strong>
                        </>
                      ) : (
                        <span>Open-ended notice (until manually concluded)</span>
                      )}
                    </span>
                    <span className="font-mono text-xs">
                      {parsedStartDate && parsedStartDate.getTime() > Date.now() ? (
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                          ● Scheduled
                        </span>
                      ) : (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          ● Active immediately
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Section 3: Affected Services & Notifications */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                    Affected Services ({affectedServiceIds.length} of {allServices.length})
                  </label>
                  {allServices.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
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
                    No services configured on this status page yet.
                  </div>
                ) : (
                  <div className="max-h-36 overflow-y-auto border border-border rounded-lg p-2 bg-background space-y-1">
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

                {/* Delivery & Active Checkboxes */}
                <div className="flex items-center gap-6 pt-2 text-xs">
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
              </div>

              {/* Error Message */}
              {announcementError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-medium">
                  {announcementError}
                </div>
              )}
            </div>

            {/* Footer / Submit */}
            <DialogFooter className="pt-3 gap-2 shrink-0 border-t border-border">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsCreateOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                isLoading={isPending}
                disabled={Boolean(timeValidationError)}
              >
                Add Announcement
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
