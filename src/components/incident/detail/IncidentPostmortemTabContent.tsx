'use client';

import React from 'react';
import Link from 'next/link';
import {
  FileText,
  CheckCircle2,
  Clock,
  Pencil,
  ArrowUpRight,
  Plus,
  AlertCircle,
  ShieldCheck,
  CheckSquare,
  Globe,
  Lock,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import {
  POSTMORTEM_STATUS_CONFIG,
  ACTION_ITEM_STATUS_CONFIG,
  ACTION_ITEM_PRIORITY_CONFIG,
} from '@/components/postmortem/shared';
import { normalizeLegacyActionItems, type ActionItem } from '@/lib/action-items';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import DueDateBadge from '@/components/action-items/DueDateBadge';

export type IncidentPostmortemTabContentProps = {
  incidentId: string;
  incidentStatus: string;
  canManage: boolean;
  eventCount: number;
  noteCount: number;
  users?: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  postmortem: {
    id: string;
    title: string;
    summary?: string | null;
    rootCause?: string | null;
    resolution?: string | null;
    lessons?: string | null;
    status?: string;
    isPublic?: boolean;
    createdAt: Date | string;
    publishedAt?: Date | string | null;
    actionItems?: unknown;
    createdBy?: {
      id: string;
      name: string;
      email: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    actionItemRecords?: Array<{
      id: string;
      title: string;
      description: string | null;
      ownerId: string | null;
      dueDate: Date | string | null;
      status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
      priority: 'HIGH' | 'MEDIUM' | 'LOW';
      completedAt?: Date | string | null;
      externalIssueLinks?: Array<{
        id: string;
        provider: string;
        externalKey: string;
        externalUrl: string;
        externalStatus: string | null;
        externalAssignee: string | null;
      }>;
    }>;
  } | null;
};

export default function IncidentPostmortemTabContent({
  incidentId,
  incidentStatus,
  canManage,
  eventCount,
  noteCount,
  users = [],
  postmortem,
}: IncidentPostmortemTabContentProps) {
  const { userTimeZone } = useTimezone();
  const isResolved = incidentStatus === 'RESOLVED';

  // 1. Postmortem Exists State
  if (postmortem) {
    const rawActionItems =
      postmortem.actionItemRecords && postmortem.actionItemRecords.length > 0
        ? postmortem.actionItemRecords
        : postmortem.actionItems;

    const actionItems: ActionItem[] = normalizeLegacyActionItems(rawActionItems, {
      legacyIdPrefix: `postmortem-${postmortem.id}`,
    });

    const completedCount = actionItems.filter(i => i.status === 'COMPLETED').length;
    const totalCount = actionItems.length;

    const statusConfig =
      POSTMORTEM_STATUS_CONFIG[postmortem.status as keyof typeof POSTMORTEM_STATUS_CONFIG] ||
      POSTMORTEM_STATUS_CONFIG.DRAFT;

    const userMap = new Map(users.map(u => [u.id, u]));

    return (
      <div className="space-y-5">
        {/* Postmortem Hero Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 dark:bg-slate-800/30 dark:border-slate-800">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border',
                  postmortem.status === 'PUBLISHED'
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400'
                )}
              >
                {statusConfig.label}
              </span>

              <Badge
                variant="outline"
                className="text-[10px] gap-1 py-0.5 px-2 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
              >
                {postmortem.isPublic ? (
                  <>
                    <Globe className="h-3 w-3 text-emerald-500" />
                    <span>Public View</span>
                  </>
                ) : (
                  <>
                    <Lock className="h-3 w-3 text-slate-400" />
                    <span>Internal Only</span>
                  </>
                )}
              </Badge>

              {postmortem.publishedAt ? (
                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  Published{' '}
                  {formatDateTime(postmortem.publishedAt, userTimeZone, { format: 'date' })}
                </span>
              ) : (
                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Clock className="h-3 w-3 text-amber-500" />
                  Created {formatDateTime(postmortem.createdAt, userTimeZone, { format: 'date' })}
                </span>
              )}
            </div>

            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
              {postmortem.title}
            </h3>

            {postmortem.createdBy && (
              <div className="flex items-center gap-2 pt-0.5">
                <UserAvatar
                  userId={postmortem.createdBy.id}
                  name={postmortem.createdBy.name}
                  gender={postmortem.createdBy.gender}
                  avatarUrl={postmortem.createdBy.avatarUrl}
                  size="xs"
                />
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  Lead author: <span className="font-semibold">{postmortem.createdBy.name}</span>
                </span>
              </div>
            )}
          </div>

          {/* Action CTAs */}
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <Link href={`/postmortems/${incidentId}?edit=true`}>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 text-xs font-semibold border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </Button>
              </Link>
            )}
            <Link href={`/postmortems/${incidentId}`}>
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <span>Full Report</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>

        {/* Executive Summary & Root Cause */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-800 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-blue-500" /> Executive Summary
            </h4>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {postmortem.summary || 'No executive summary provided.'}
            </p>
          </div>

          <div className="p-4 rounded-xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-800 space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-rose-500" /> Root Cause &amp; Contributing
              Factors
            </h4>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
              {postmortem.rootCause || 'Root cause investigation not documented.'}
            </p>
          </div>
        </div>

        {/* Action Items Preview */}
        <div className="rounded-xl border border-slate-200/80 bg-white dark:bg-slate-900 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-emerald-500" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                Action Items ({completedCount}/{totalCount} Completed)
              </h4>
            </div>
            {canManage && (
              <Link
                href={`/postmortems/${incidentId}?edit=true#action-items`}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <span>Manage</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {actionItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No follow-up action items tracked yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {actionItems.map(item => {
                const owner = item.owner ? userMap.get(item.owner) : null;
                const statusCfg =
                  ACTION_ITEM_STATUS_CONFIG[
                    item.status as keyof typeof ACTION_ITEM_STATUS_CONFIG
                  ] || ACTION_ITEM_STATUS_CONFIG.OPEN;
                const priorityCfg =
                  ACTION_ITEM_PRIORITY_CONFIG[
                    item.priority as keyof typeof ACTION_ITEM_PRIORITY_CONFIG
                  ] || ACTION_ITEM_PRIORITY_CONFIG.MEDIUM;

                return (
                  <div
                    key={item.id}
                    className="p-3 sm:px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
                  >
                    <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0',
                          statusCfg.bg,
                          statusCfg.color,
                          statusCfg.border
                        )}
                      >
                        {statusCfg.label}
                      </span>
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                        {item.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <span
                        className={cn(
                          'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                          priorityCfg.bg,
                          priorityCfg.color
                        )}
                      >
                        {priorityCfg.label}
                      </span>

                      {item.externalIssue && (
                        <ActionItemJiraBadge
                          actionItemId={item.id}
                          externalIssue={item.externalIssue}
                          canManage={canManage}
                          compact
                        />
                      )}

                      {item.dueDate && (
                        <DueDateBadge
                          dueDate={item.dueDate}
                          completedAt={item.completedAt}
                          status={item.status}
                          userTimeZone={userTimeZone}
                        />
                      )}

                      {owner && (
                        <div className="flex items-center gap-1 pl-1">
                          <UserAvatar
                            userId={owner.id}
                            name={owner.name}
                            gender={owner.gender}
                            avatarUrl={owner.avatarUrl}
                            size="xs"
                          />
                          <span className="text-[11px] text-slate-600 dark:text-slate-400 max-w-[100px] truncate">
                            {owner.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 2. Incident Resolved, Postmortem Not Yet Started
  if (isResolved) {
    return (
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 dark:bg-slate-800/20 dark:border-slate-800 p-6 sm:p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto shadow-xs border border-indigo-100 dark:border-indigo-900/50">
          <FileText className="h-6 w-6" />
        </div>

        <div className="max-w-md mx-auto space-y-1.5">
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Post-Incident Review Not Started
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Document what happened, determine root causes, and track follow-up action items to
            prevent future occurrences.
          </p>
        </div>

        {/* Readiness stats */}
        <div className="inline-flex items-center justify-center gap-3 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
          <span className="flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400">
            <FileText className="h-3.5 w-3.5" />
            Auto-Draft Ready
          </span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span>{eventCount} Timeline Events</span>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <span>{noteCount} Responder Notes</span>
        </div>

        <div className="pt-2">
          {canManage ? (
            <Link href={`/postmortems/${incidentId}`}>
              <Button className="h-9 gap-2 px-5 text-xs font-semibold shadow-xs">
                <Plus className="h-4 w-4" />
                <span>Create Postmortem</span>
              </Button>
            </Link>
          ) : (
            <p className="text-xs text-slate-400 italic">
              Post-incident reviews can be started by responders and admins.
            </p>
          )}
        </div>
      </div>
    );
  }

  // 3. Incident Active (TRIGGERED or ACKNOWLEDGED)
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/40 dark:bg-slate-800/20 dark:border-slate-800 p-6 sm:p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center mx-auto shadow-xs border border-slate-200/60 dark:border-slate-700">
        <Clock className="h-6 w-6" />
      </div>

      <div className="max-w-md mx-auto space-y-1.5">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Postmortem Available Upon Resolution
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Post-incident reviews become available once this incident is resolved. All operational
          milestones, notes, and metrics recorded during the response will automatically feed the
          initial postmortem draft.
        </p>
      </div>

      <div className="inline-flex items-center justify-center gap-3 p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
        <span className="flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-blue-500" />
          Status: {incidentStatus}
        </span>
        <span className="text-slate-300 dark:text-slate-700">|</span>
        <span>{eventCount} Events Recorded</span>
        <span className="text-slate-300 dark:text-slate-700">|</span>
        <span>{noteCount} Notes Logged</span>
      </div>
    </div>
  );
}
