'use client';

import React, { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatRelativeShort } from '@/lib/mobile-time';
import { haptics } from '@/lib/haptics';
import { motion, useMotionValue, useTransform, PanInfo, useAnimation } from 'framer-motion';

interface SwipeableIncidentCardProps {
  incident: {
    id: string;
    title: string;
    status: string;
    urgency?: string | null;
    createdAt: string | Date;
    service?: { name: string } | null;
  };
  onAcknowledge?: (id: string) => void;
  onSnooze?: (id: string) => void;
  onResolve?: (id: string) => void;
  isUpdating?: boolean;
}

const resolveStatusStyle = (statusKey: string) => {
  switch (statusKey) {
    case 'open':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    case 'acknowledged':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
    case 'resolved':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
    case 'snoozed':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400';
    case 'suppressed':
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
};

const resolveUrgencyStyle = (urgencyKey: string) => {
  switch (urgencyKey) {
    case 'high':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    case 'medium':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
    case 'low':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  }
};

export default function SwipeableIncidentCard({
  incident,
  onAcknowledge,
  onSnooze,
  onResolve,
  isUpdating = false,
}: SwipeableIncidentCardProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [swipedAction, setSwipedAction] = useState<'left' | 'right' | null>(null);

  const statusKey = incident.status.toLowerCase();
  const urgencyKey = (incident.urgency || 'low').toLowerCase();
  const createdAt = new Date(incident.createdAt);
  const timeAgo = formatRelativeShort(createdAt, userTimeZone);
  const statusStyle = resolveStatusStyle(statusKey);
  const urgencyStyle = resolveUrgencyStyle(urgencyKey);

  const controls = useAnimation();
  const x = useMotionValue(0);
  const swipeThreshold = 80;

  const leftAction =
    statusKey === 'open' && onAcknowledge
      ? { label: 'ACK', tone: 'amber', handler: onAcknowledge }
      : null;

  const rightAction =
    statusKey === 'open' && onSnooze
      ? { label: 'SNOOZE', tone: 'blue', handler: onSnooze }
      : statusKey !== 'resolved' && onResolve
        ? { label: 'RESOLVE', tone: 'emerald', handler: onResolve }
        : null;

  // Background color based on swipe direction
  const background = useTransform(
    x,
    [-150, 0, 150],
    [
      rightAction
        ? rightAction.tone === 'blue'
          ? 'rgba(59, 130, 246, 0.2)'
          : 'rgba(16, 185, 129, 0.2)'
        : 'transparent',
      'transparent',
      leftAction ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
    ]
  );

  const handleDragEnd = async (_: unknown, info: PanInfo) => {
    const offset = info.offset.x;

    if (offset > swipeThreshold && leftAction) {
      setSwipedAction('right'); // Swiped right (revealing left action)
      haptics.success();
      leftAction.handler(incident.id);
      await controls.start({ x: 0 }); // Reset after action
      setSwipedAction(null);
    } else if (offset < -swipeThreshold && rightAction) {
      setSwipedAction('left'); // Swiped left (revealing right action)
      haptics.success();
      rightAction.handler(incident.id);
      await controls.start({ x: 0 }); // Reset after action
      setSwipedAction(null);
    } else {
      controls.start({ x: 0 });
    }
  };

  const handleOpenDetails = () => {
    if (isUpdating) return;
    haptics.soft();
    router.push(`/m/incidents/${incident.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenDetails();
    }
    // Keyboard shortcuts for actions could be added here if desired,
    // but navigating to details is the primary keyboard flow.
  };

  return (
    <div
      className="relative rounded-xl overflow-hidden bg-[color:var(--bg-surface)]"
      data-swipe-ignore="true"
    >
      {/* Background Actions Layer */}
      <motion.div
        className="absolute inset-0 flex items-center justify-between px-6 pointer-events-none"
        style={{ background }}
      >
        <div
          className={cn(
            'flex items-center gap-2 font-bold transition-opacity',
            leftAction ? 'text-amber-500' : 'opacity-0'
          )}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          {leftAction?.label}
        </div>

        <div
          className={cn(
            'flex items-center gap-2 font-bold transition-opacity',
            rightAction
              ? rightAction.tone === 'blue'
                ? 'text-blue-500'
                : 'text-emerald-500'
              : 'opacity-0'
          )}
        >
          {rightAction?.label}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {rightAction?.tone === 'emerald' ? (
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            ) : (
              <circle cx="12" cy="12" r="10" />
            )}
            {rightAction?.tone === 'emerald' && <path d="M22 4L12 14.01l-3-3" />}
            {rightAction?.tone === 'blue' && <path d="M12 6v6l4 2" />}
          </svg>
        </div>
      </motion.div>

      {/* Foreground Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        onDragEnd={handleDragEnd}
        animate={controls}
        style={{ x }}
        whileTap={{ cursor: 'grabbing' }}
        onClick={handleOpenDetails}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        data-swipe-ignore="true"
        aria-label={`Incident: ${incident.title}. Status: ${incident.status}. Swipe right to ${leftAction?.label || 'acknowledge'}, swipe left to ${rightAction?.label || 'snooze/resolve'}`}
        className={cn(
          'relative flex flex-col gap-2 p-4 rounded-xl border transition-colors bg-[var(--bg-surface)] z-10',
          'border-[color:var(--border)]',
          isUpdating
            ? 'cursor-wait opacity-60'
            : 'cursor-grab active:cursor-grabbing focus:ring-2 focus:ring-primary focus:outline-none'
        )}
      >
        {/* Header with status and urgency */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide',
              statusStyle
            )}
          >
            {incident.status}
          </span>
          {incident.urgency && (
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                urgencyStyle
              )}
            >
              {incident.urgency}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-[color:var(--text-primary)] leading-snug line-clamp-2">
          {incident.title}
        </h3>

        {/* Meta info */}
        <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
          {incident.service?.name && (
            <>
              <span className="truncate">{incident.service.name}</span>
              <span className="text-[color:var(--text-disabled)]">•</span>
            </>
          )}
          <span suppressHydrationWarning>{timeAgo}</span>
        </div>

        {/* Accessible Swipe Hint (Visible on Focus / Screen Readers) */}
        <div className="sr-only">
          Press Enter to view details.
          {leftAction && ` Swipe right to ${leftAction.label.toLowerCase()}.`}
          {rightAction && ` Swipe left to ${rightAction.label.toLowerCase()}.`}
        </div>
      </motion.div>

      {/* Updating Overlay */}
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-background/50 backdrop-blur-[1px] rounded-xl">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground animate-pulse">
            <div
              className="w-2 h-2 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <div
              className="w-2 h-2 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <div
              className="w-2 h-2 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
