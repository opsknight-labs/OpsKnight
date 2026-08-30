'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { Button } from '@/components/ui/shadcn/button';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';
import AuditActionBadge from './AuditActionBadge';
import { Copy, Check, ExternalLink, ShieldCheck, User, Layers } from 'lucide-react';
import { formatDateTime } from '@/lib/timezone';

export type AuditLogEntry = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actor?: {
    id?: string;
    name: string | null;
    email: string | null;
    avatarUrl?: string | null;
  } | null;
  details: string;
};

export type AuditDetailModalProps = {
  log: AuditLogEntry | null;
  isOpen: boolean;
  onClose: () => void;
  userTimeZone?: string;
};

export function getEntityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  const upper = entityType.toUpperCase();
  if (upper === 'INCIDENT') return `/incidents/${entityId}`;
  if (upper === 'USER') return `/users/${entityId}`;
  if (upper === 'TEAM') return `/teams/${entityId}`;
  if (upper === 'SERVICE') return `/services/${entityId}`;
  if (upper === 'ESCALATION_POLICY' || upper === 'POLICY') return `/policies/${entityId}`;
  if (upper === 'SCHEDULE') return `/schedules/${entityId}`;
  return null;
}

export default function AuditDetailModal({
  log,
  isOpen,
  onClose,
  userTimeZone = 'UTC',
}: AuditDetailModalProps) {
  const [copied, setCopied] = useState(false);

  if (!log) return null;

  const entityHref = getEntityHref(log.entityType, log.entityId);

  let formattedJson = log.details;
  let parsedObject: unknown = null;
  try {
    if (log.details && log.details !== '-' && log.details !== '[Details unavailable]') {
      parsedObject = JSON.parse(log.details);
      formattedJson = JSON.stringify(parsedObject, null, 2);
    }
  } catch {
    formattedJson = log.details;
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden bg-white">
        {/* Header */}
        <DialogHeader className="p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <DialogTitle className="text-base font-semibold">Audit Record Details</DialogTitle>
            </div>
            <AuditActionBadge action={log.action} />
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-1">
            Recorded at {formatDateTime(log.createdAt, userTimeZone, { format: 'datetime' })} • ID:{' '}
            {log.id}
          </DialogDescription>
        </DialogHeader>

        {/* Body Content */}
        <div className="p-5 space-y-5 overflow-y-auto flex-1 text-sm">
          {/* Metadata Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Actor Card */}
            <div className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/40 space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                Actor
              </div>
              <div className="flex items-center gap-2.5 pt-0.5">
                {log.actor ? (
                  <DirectUserAvatar
                    avatarUrl={
                      log.actor.avatarUrl ||
                      getDefaultAvatar(undefined, log.actor.id || log.actor.name || 'user')
                    }
                    name={log.actor.name}
                    size="sm"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-[0.65rem] font-semibold text-gray-600">
                    SYS
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">
                    {log.actor?.id ? (
                      <Link
                        href={`/users/${log.actor.id}`}
                        className="hover:underline text-primary"
                      >
                        {log.actor?.name || log.actorName || 'System'}
                      </Link>
                    ) : (
                      log.actor?.name || log.actorName || 'System'
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {log.actor?.email || log.actorEmail || 'system@opsknight.internal'}
                  </div>
                </div>
              </div>
            </div>

            {/* Target Entity Card */}
            <div className="p-3 rounded-lg border border-slate-200/80 bg-slate-50/40 space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Target Entity
              </div>
              <div className="pt-0.5">
                <div className="font-semibold text-xs text-foreground flex items-center gap-1.5">
                  <span className="bg-slate-200/70 px-1.5 py-0.5 rounded text-[11px] font-mono">
                    {log.entityType}
                  </span>
                  {entityHref ? (
                    <Link
                      href={entityHref}
                      className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-mono"
                    >
                      <span>{log.entityId}</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">
                      {log.entityId || 'N/A'}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  Scope: {log.entityType.replace(/_/g, ' ').toLowerCase()}
                </div>
              </div>
            </div>
          </div>

          {/* Details / JSON Payload */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payload / Changes Data
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="h-7 px-2.5 text-xs gap-1 shadow-sm"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-600 font-medium">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Copy JSON</span>
                  </>
                )}
              </Button>
            </div>

            <div className="relative rounded-lg border border-slate-200 bg-slate-900 text-slate-100 p-3.5 font-mono text-xs overflow-x-auto max-h-[280px]">
              <pre className="whitespace-pre leading-relaxed">{formattedJson}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
