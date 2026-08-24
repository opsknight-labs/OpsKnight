'use client';

import Link from 'next/link';
import PostmortemTimeline from './PostmortemTimeline';
import PostmortemImpactMetrics from './PostmortemImpactMetrics';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { Calendar, Pencil } from 'lucide-react';
import { normalizeLegacyActionItems } from '@/lib/action-items';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import {
  POSTMORTEM_STATUS_CONFIG,
  ACTION_ITEM_STATUS_CONFIG,
  ACTION_ITEM_PRIORITY_CONFIG,
} from './shared';
import { type TimelineEvent, type ImpactMetrics } from '@/app/(app)/postmortems/actions';

interface PostmortemDetailViewProps {
  postmortem: {
    id: string;
    title: string;
    summary?: string | null;
    timeline?: unknown; // JSON from database
    impact?: unknown; // JSON from database
    rootCause?: string | null;
    resolution?: string | null;
    actionItems?: unknown; // JSON from database
    lessons?: string | null;
    status?: string;
    createdAt: Date;
    publishedAt?: Date | null;
    createdBy: {
      id: string;
      name: string;
      email: string;
      avatarUrl?: string | null;
      gender?: string | null;
    } | null;
    incident: {
      id: string;
      title: string;
      resolvedAt?: Date | null;
    };
  };
  users?: Array<{
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    gender?: string | null;
  }>;
  canEdit?: boolean;
  incidentId: string;
  isPublicView?: boolean;
}

export default function PostmortemDetailView({
  postmortem,
  users = [],
  canEdit = false,
  incidentId,
  isPublicView = false,
}: PostmortemDetailViewProps) {
  const { userTimeZone } = useTimezone();

  // Parse data
  const parseTimeline = (timeline: unknown): TimelineEvent[] => {
    if (!timeline || !Array.isArray(timeline)) return [];
    return timeline.map((e: any) => ({
      id: e.id || `event-${Date.now()}`,
      timestamp: e.timestamp || new Date().toISOString(),
      type: e.type || 'DETECTION',
      title: e.title || '',
      description: e.description || '',
      actor: isPublicView ? undefined : e.actor, // Anonymize actor in public view
    }));
  };

  const parseImpact = (impact: unknown): ImpactMetrics => {
    if (!impact || typeof impact !== 'object') return {};
    const imp = impact as any;
    return {
      usersAffected: imp.usersAffected,
      downtimeMinutes: imp.downtimeMinutes,
      errorRate: imp.errorRate,
      servicesAffected: Array.isArray(imp.servicesAffected) ? imp.servicesAffected : [],
      slaBreaches: isPublicView ? undefined : imp.slaBreaches, // Hide SLA details in public view
      revenueImpact: isPublicView ? undefined : imp.revenueImpact, // Hide revenue in public view
      apiErrors: imp.apiErrors,
      performanceDegradation: imp.performanceDegradation,
    };
  };

  const timelineEvents = parseTimeline(postmortem.timeline);
  const impactMetrics = parseImpact(postmortem.impact);
  const actionItems = isPublicView
    ? []
    : normalizeLegacyActionItems(postmortem.actionItems, {
        legacyIdPrefix: `postmortem-${postmortem.id}`,
      });

  const completedActions = actionItems.filter(item => item.status === 'COMPLETED').length;
  const totalActions = actionItems.length;
  const completionRate = totalActions > 0 ? (completedActions / totalActions) * 100 : 0;

  const statusConfig =
    POSTMORTEM_STATUS_CONFIG[postmortem.status as keyof typeof POSTMORTEM_STATUS_CONFIG] ||
    POSTMORTEM_STATUS_CONFIG.DRAFT;

  return (
    <div className="flex flex-col gap-6">
      {/* Hero Section */}
      <Card className="bg-gradient-to-br from-white to-slate-50 shadow-lg overflow-hidden relative">
        {/* Decorative gradient */}
        <div className="absolute top-0 right-0 w-72 h-72 bg-[radial-gradient(circle,rgba(211,47,47,0.05)_0%,transparent_70%)] rounded-full translate-x-[30%] -translate-y-[30%] pointer-events-none" />

        <CardContent className="p-8">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div className="flex-1">
              <h1 className="text-4xl font-extrabold mb-3 bg-gradient-to-br from-slate-800 to-slate-500 bg-clip-text text-transparent tracking-tight leading-tight">
                {postmortem.title}
              </h1>
              <p className="text-muted-foreground">
                Postmortem for{' '}
                <Link
                  href={isPublicView ? '#' : `/incidents/${postmortem.incident.id}`}
                  className={cn(
                    'text-primary font-medium',
                    isPublicView ? 'cursor-default text-muted-foreground' : 'hover:underline'
                  )}
                >
                  {postmortem.incident.title}
                </Link>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
              {canEdit && !isPublicView && (
                <Link href={`/postmortems/${incidentId}?edit=true`}>
                  <Button>
                    <Pencil className="w-4 h-4 mr-2" />
                    Edit Postmortem
                  </Button>
                </Link>
              )}
            </div>
          </div>
          <div className="flex gap-4 pt-4 border-t border-slate-200 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              {!isPublicView && postmortem.createdBy && (
                <UserAvatar
                  userId={postmortem.createdBy.id}
                  name={postmortem.createdBy.name}
                  gender={postmortem.createdBy.gender}
                  size="xs"
                />
              )}
              Created by{' '}
              <strong>
                {isPublicView ? 'OpsKnight Team' : postmortem.createdBy?.name || 'Deleted user'}
              </strong>
            </span>
            <span>•</span>
            <span>{formatDateTime(postmortem.createdAt, userTimeZone, { format: 'date' })}</span>
            {postmortem.publishedAt && (
              <>
                <span>•</span>
                <span>
                  Published{' '}
                  {formatDateTime(postmortem.publishedAt, userTimeZone, { format: 'date' })}
                </span>
              </>
            )}
            {postmortem.incident.resolvedAt && (
              <>
                <span>•</span>
                <span>
                  Resolved{' '}
                  {formatDateTime(postmortem.incident.resolvedAt, userTimeZone, { format: 'date' })}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Executive Summary */}
      {postmortem.summary && (
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <span className="w-1 h-6 bg-gradient-to-b from-primary to-red-500 rounded" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground whitespace-pre-wrap leading-relaxed pl-6">
              {postmortem.summary}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      {timelineEvents.length > 0 && (
        <PostmortemTimeline
          events={timelineEvents}
          incidentStartTime={
            postmortem.incident.resolvedAt ? undefined : new Date(postmortem.createdAt)
          }
          incidentEndTime={postmortem.incident.resolvedAt || undefined}
        />
      )}

      {/* Impact Metrics */}
      {Object.keys(impactMetrics).length > 0 && <PostmortemImpactMetrics metrics={impactMetrics} />}

      {/* Root Cause & Resolution */}
      {(postmortem.rootCause || postmortem.resolution) && (
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Analysis</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {postmortem.rootCause && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Root Cause</h3>
                <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                  {postmortem.rootCause}
                </p>
              </div>
            )}
            {postmortem.resolution && (
              <div>
                <h3 className="text-lg font-semibold mb-2">Resolution</h3>
                <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                  {postmortem.resolution}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {actionItems.length > 0 && (
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-xl">Action Items</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {completedActions}/{totalActions} completed
                </span>
                <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      completionRate === 100 ? 'bg-green-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {actionItems.map(item => {
              const owner = users.find(u => u.id === item.owner);
              const isOverdue =
                item.dueDate && new Date(item.dueDate) < new Date() && item.status !== 'COMPLETED';
              const statusCfg =
                ACTION_ITEM_STATUS_CONFIG[item.status as keyof typeof ACTION_ITEM_STATUS_CONFIG];
              const priorityCfg =
                ACTION_ITEM_PRIORITY_CONFIG[
                  item.priority as keyof typeof ACTION_ITEM_PRIORITY_CONFIG
                ];

              return (
                <div
                  key={item.id}
                  className={cn('p-4 bg-white rounded-md border-2 border-l-4', statusCfg.border)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold',
                            statusCfg.bg,
                            statusCfg.color
                          )}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-xs font-semibold',
                            priorityCfg.bg,
                            priorityCfg.color
                          )}
                        >
                          {item.priority} Priority
                        </span>
                        {isOverdue && (
                          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-500/20 text-red-500">
                            Overdue
                          </span>
                        )}
                      </div>
                      <h4 className="text-base font-semibold mb-1">{item.title}</h4>
                      {!isPublicView && (
                        <ActionItemJiraBadge
                          actionItemId={item.id}
                          externalIssue={item.externalIssue}
                          canManage={canEdit}
                          compact
                        />
                      )}
                      {item.description && (
                        <p className="text-sm text-muted-foreground mb-1">{item.description}</p>
                      )}
                      <div className="flex gap-3 text-xs text-muted-foreground">
                        {owner && (
                          <span className="flex items-center gap-1">
                            <UserAvatar
                              userId={owner.id}
                              name={owner.name}
                              gender={owner.gender}
                              size="xs"
                            />
                            {owner.name}
                          </span>
                        )}
                        {item.dueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            Due: {formatDateTime(item.dueDate, userTimeZone, { format: 'date' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Lessons Learned */}
      {postmortem.lessons && (
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Lessons Learned</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-foreground whitespace-pre-wrap leading-relaxed">
              {postmortem.lessons}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
