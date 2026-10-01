'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { notify } from '@/lib/toast';
import { Copy, Check, Lock, Users, Globe2, Loader2, Sparkles } from 'lucide-react';

interface DashboardShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  dashboardId?: string;
  dashboardName: string;
  isTemplate?: boolean;
  currentVisibility?: 'PRIVATE' | 'TEAM' | 'PUBLIC';
  currentFilters: {
    windowDays: number;
    teamId?: string;
    serviceId?: string;
  };
  onVisibilityChange?: (visibility: 'PRIVATE' | 'TEAM' | 'PUBLIC') => void;
}

export default function DashboardShareModal({
  isOpen,
  onClose,
  dashboardId,
  dashboardName,
  isTemplate = false,
  currentVisibility = 'PRIVATE',
  currentFilters,
  onVisibilityChange,
}: DashboardShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [selectedVisibility, setSelectedVisibility] = useState<'PRIVATE' | 'TEAM' | 'PUBLIC'>(
    currentVisibility
  );
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

  // Generate complete shareable URL including active filters
  const getShareUrl = () => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams();
    if (currentFilters.windowDays && currentFilters.windowDays !== 7) {
      params.set('window', String(currentFilters.windowDays));
    }
    if (currentFilters.teamId) {
      params.set('teamId', currentFilters.teamId);
    }
    if (currentFilters.serviceId) {
      params.set('serviceId', currentFilters.serviceId);
    }

    const basePath = dashboardId
      ? `/reports/executive/${dashboardId}`
      : `/reports/executive`;
    const qs = params.toString();
    return `${window.location.origin}${basePath}${qs ? `?${qs}` : ''}`;
  };

  const handleCopyLink = async () => {
    const url = getShareUrl();
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      notify.success('Link copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      notify.error('Failed to copy link to clipboard');
    }
  };

  const handleUpdateVisibility = async (newVisibility: 'PRIVATE' | 'TEAM' | 'PUBLIC') => {
    setSelectedVisibility(newVisibility);
    if (!dashboardId || isTemplate) return;

    setIsUpdatingVisibility(true);
    try {
      const response = await fetch(`/api/dashboards/${dashboardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: newVisibility }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'Failed to update visibility');
      }

      onVisibilityChange?.(newVisibility);
      notify.success(`Dashboard visibility updated to ${newVisibility.toLowerCase()}`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Failed to update visibility');
      setSelectedVisibility(currentVisibility);
    } finally {
      setIsUpdatingVisibility(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span>Share Dashboard</span>
            {isTemplate && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                <Sparkles className="h-3 w-3" />
                Template
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {isTemplate
              ? `Share a direct link to "${dashboardName}". Anyone with access can view and clone it.`
              : `Share "${dashboardName}" with teammates or change who in your organization can access it.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Share Link Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Shareable Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={getShareUrl()}
                className="flex-1 bg-muted/50 border border-input rounded-md px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary select-all"
                onClick={e => (e.target as HTMLInputElement).select()}
              />
              <Button
                type="button"
                size="sm"
                variant={copied ? 'default' : 'secondary'}
                className="gap-1.5 shrink-0 transition-all"
                onClick={handleCopyLink}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Current filter parameters (time window and service scope) are included in this link.
            </p>
          </div>

          {/* Visibility Controls for Saved Dashboards */}
          {!isTemplate && dashboardId && (
            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                <span>Access Permissions</span>
                {isUpdatingVisibility && (
                  <span className="flex items-center gap-1 text-[11px] text-primary normal-case font-normal">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Updating...
                  </span>
                )}
              </label>

              <div className="grid grid-cols-1 gap-2">
                {/* PRIVATE */}
                <button
                  type="button"
                  onClick={() => handleUpdateVisibility('PRIVATE')}
                  disabled={isUpdatingVisibility}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                    selectedVisibility === 'PRIVATE'
                      ? 'bg-primary/5 border-primary/60 text-foreground ring-1 ring-primary/40'
                      : 'bg-card border-border hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <Lock className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Private</div>
                    <div className="text-[11px] text-muted-foreground">
                      Only you can view and modify this dashboard.
                    </div>
                  </div>
                </button>

                {/* TEAM */}
                <button
                  type="button"
                  onClick={() => handleUpdateVisibility('TEAM')}
                  disabled={isUpdatingVisibility}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                    selectedVisibility === 'TEAM'
                      ? 'bg-primary/5 border-primary/60 text-foreground ring-1 ring-primary/40'
                      : 'bg-card border-border hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <Users className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Team</div>
                    <div className="text-[11px] text-muted-foreground">
                      Members of your assigned team can view this dashboard.
                    </div>
                  </div>
                </button>

                {/* PUBLIC */}
                <button
                  type="button"
                  onClick={() => handleUpdateVisibility('PUBLIC')}
                  disabled={isUpdatingVisibility}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                    selectedVisibility === 'PUBLIC'
                      ? 'bg-primary/5 border-primary/60 text-foreground ring-1 ring-primary/40'
                      : 'bg-card border-border hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <Globe2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">Organization (Public)</div>
                    <div className="text-[11px] text-muted-foreground">
                      Anyone in your OpsKnight organization can discover and view this dashboard.
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
