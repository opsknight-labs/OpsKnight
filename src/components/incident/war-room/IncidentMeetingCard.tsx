'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import {
  Video,
  ExternalLink,
  Copy,
  Check,
  RotateCw,
  Phone,
  AlertCircle,
  X,
  Loader2,
} from 'lucide-react';
import type { IncidentMeetingView } from '@/lib/incident-collaboration/types';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';

type IncidentMeetingCardProps = {
  meeting: IncidentMeetingView;
  onAction?: (action: 'PROVISION' | 'RETRY' | 'CLOSE') => Promise<void> | void;
  className?: string;
};

export function IncidentMeetingCard({ meeting, onAction, className }: IncidentMeetingCardProps) {
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!meeting.joinUrl) return;
    try {
      await navigator.clipboard.writeText(meeting.joinUrl);
      setCopied(true);
      notify.success('Meeting link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error('Failed to copy meeting link');
    }
  };

  const handleProvision = async () => {
    if (!onAction) return;
    setPendingAction('PROVISION');
    try {
      await onAction('PROVISION');
      notify.success('Provisioning meeting bridge...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to provision meeting';
      notify.error(msg);
    } finally {
      setPendingAction(null);
    }
  };

  const handleRetry = async () => {
    if (!onAction) return;
    setPendingAction('RETRY');
    try {
      await onAction('RETRY');
      notify.success('Retrying meeting provisioning...');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retry meeting provisioning';
      notify.error(msg);
    } finally {
      setPendingAction(null);
    }
  };

  const handleClose = async () => {
    if (!onAction) return;
    setPendingAction('CLOSE');
    try {
      await onAction('CLOSE');
      notify.success('Meeting closed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to close meeting';
      notify.error(msg);
    } finally {
      setPendingAction(null);
    }
  };

  // Provider branding helper
  const renderProviderIcon = () => {
    if (meeting.provider === 'MICROSOFT_TEAMS') {
      return (
        <div className="p-1.5 rounded-md bg-muted border border-border/80 shrink-0">
          <MicrosoftTeamsLogo className="h-4 w-4" />
        </div>
      );
    }

    return (
      <div className="p-1.5 rounded-md bg-muted border border-border/80 text-foreground shrink-0">
        <Video className="h-4 w-4" />
      </div>
    );
  };

  const providerDisplayName = {
    MICROSOFT_TEAMS: 'Microsoft Teams Meeting',
    ZOOM: 'Zoom Meeting',
    GOOGLE_MEET: 'Google Meet',
    JITSI: 'Jitsi Meet',
    NONE: 'Disabled',
  }[meeting.provider];

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card p-4 shadow-sm text-xs space-y-3 transition-all',
        meeting.state === 'READY' && 'border-emerald-500/30 bg-emerald-500/[0.02]',
        meeting.state === 'FAILED' && 'border-red-500/30 bg-red-500/[0.02]',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          {renderProviderIcon()}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-foreground truncate">{providerDisplayName}</span>
              {meeting.state === 'READY' && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] px-1.5 py-0 h-4 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-normal shrink-0"
                >
                  Ready
                </Badge>
              )}
              {meeting.state === 'PROVISIONING' && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-normal shrink-0 flex items-center gap-1"
                >
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  Generating
                </Badge>
              )}
              {meeting.state === 'REQUESTED' && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[9.5px] px-1.5 py-0 h-4 font-normal shrink-0',
                    meeting.readiness === 'ORGANIZER_REQUIRED'
                      ? 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                      : meeting.readiness === 'PERMISSION_REQUIRED'
                        ? 'border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10'
                        : 'border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/10'
                  )}
                >
                  {meeting.readiness === 'ORGANIZER_REQUIRED'
                    ? 'Organizer Required'
                    : meeting.readiness === 'PERMISSION_REQUIRED'
                      ? 'Permission Required'
                      : 'Not started'}
                </Badge>
              )}
              {meeting.state === 'FAILED' && (
                <Badge
                  variant="outline"
                  className="text-[9.5px] px-1.5 py-0 h-4 border-red-500/40 text-red-600 dark:text-red-400 bg-red-500/10 font-normal shrink-0"
                >
                  Failed
                </Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              Canonical audio/video bridge for this incident
            </p>
          </div>
        </div>

        {/* Close meeting action */}
        {meeting.actions.canClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClose}
            disabled={pendingAction === 'CLOSE'}
            className="h-7 w-7 p-0 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-900 border border-slate-200/80 shadow-2xs transition-all duration-150 active:scale-95 cursor-pointer dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-400 dark:hover:text-slate-100 dark:border-slate-700 shrink-0"
            title={meeting.actions.closeLabel ?? 'Close meeting'}
            aria-label={meeting.actions.closeLabel ?? 'Close meeting'}
          >
            {pendingAction === 'CLOSE' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <X className="h-3.5 w-3.5 stroke-[2.25]" />
            )}
          </Button>
        )}
      </div>

      {/* Audio Conferencing / Dial-in Details */}
      {(meeting.conferenceId || meeting.tollNumber) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground bg-muted/30 px-2.5 py-1.5 rounded-md border border-border/60">
          {meeting.tollNumber && (
            <div className="flex items-center gap-1">
              <Phone className="h-3 w-3 shrink-0" />
              <span>Dial: {meeting.tollNumber}</span>
            </div>
          )}
          {meeting.conferenceId && (
            <div>
              <span>Conf ID: {meeting.conferenceId}</span>
            </div>
          )}
        </div>
      )}

      {/* Pre-provisioning Configuration alert */}
      {meeting.state === 'REQUESTED' &&
        !meeting.actions.canProvision &&
        meeting.lastErrorMessage && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-[11px] leading-snug">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-semibold block">Configuration Required</span>
              <span className="text-[10.5px] opacity-90 break-words">
                {meeting.lastErrorMessage}
              </span>
            </div>
          </div>
        )}

      {/* Error state alert */}
      {meeting.state === 'FAILED' && (
        <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-[11px] leading-snug">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold block">Meeting creation failed</span>
            <span className="text-[10.5px] opacity-90 break-words">
              {meeting.lastErrorMessage || 'Unable to establish video bridge.'}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-2 pt-1">
        {meeting.actions.canProvision && (
          <Button
            type="button"
            size="sm"
            onClick={handleProvision}
            disabled={pendingAction === 'PROVISION'}
            className="h-7 text-xs font-semibold gap-1.5 px-3 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {pendingAction === 'PROVISION' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Video className="h-3 w-3 shrink-0" />
            )}
            <span>Start Meeting Bridge</span>
          </Button>
        )}

        {meeting.actions.canJoin && meeting.joinUrl && (
          <Button
            asChild
            size="sm"
            className="h-7 text-xs font-semibold gap-1.5 px-3 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">
              <span>Join Meeting</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </Button>
        )}

        {meeting.actions.canJoin && meeting.joinUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 text-xs gap-1 px-2.5 border-border hover:bg-muted/50"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 text-muted-foreground" />
                <span>Copy Link</span>
              </>
            )}
          </Button>
        )}

        {meeting.actions.canRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRetry}
            disabled={pendingAction === 'RETRY'}
            className="h-7 text-xs gap-1.5 px-2.5 border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
          >
            <RotateCw className={cn('h-3 w-3', pendingAction === 'RETRY' && 'animate-spin')} />
            <span>Retry Meeting</span>
          </Button>
        )}
      </div>
    </div>
  );
}
