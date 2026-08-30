'use client';

import { useState } from 'react';
import Link from 'next/link';
import PostmortemTimeline from './PostmortemTimeline';
import PostmortemImpactMetrics from './PostmortemImpactMetrics';
import FiveWhysBuilder from './FiveWhysBuilder';
import ContributingFactorsSelector, { type FactorType } from './ContributingFactorsSelector';
import DueDateBadge from '@/components/action-items/DueDateBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import UserAvatar from '@/components/UserAvatar';
import { cn } from '@/lib/utils';
import { Pencil, Globe, Eye, EyeOff, Sparkles } from 'lucide-react';
import { normalizeLegacyActionItems } from '@/lib/action-items';
import ActionItemJiraBadge from '@/components/action-items/ActionItemJiraBadge';
import { togglePostmortemPublicStatus } from '@/app/(app)/postmortems/actions';
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
    isPublic?: boolean;
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
  isPublicView: initialPublicView = false,
}: PostmortemDetailViewProps) {
  const { userTimeZone } = useTimezone();

  const [isPublic, setIsPublic] = useState(postmortem.isPublic ?? true);
  const [isUpdatingPublic, setIsUpdatingPublic] = useState(false);
  const [previewAsPublic, setPreviewAsPublic] = useState(false);

  const effectivePublicView = initialPublicView || previewAsPublic;

  const handleTogglePublic = async () => {
    setIsUpdatingPublic(true);
    const nextState = !isPublic;
    setIsPublic(nextState);

    try {
      const res = await togglePostmortemPublicStatus(postmortem.id, nextState);
      if (!res.success) {
        setIsPublic(!nextState); // rollback
      }
    } catch {
      setIsPublic(!nextState); // rollback
    } finally {
      setIsUpdatingPublic(false);
    }
  };

  // Parse data
  const parseTimeline = (timeline: unknown): TimelineEvent[] => {
    if (!timeline || !Array.isArray(timeline)) return [];
    return timeline.map((e: any) => ({
      id: e.id || `event-${Date.now()}`,
      timestamp: e.timestamp || new Date().toISOString(),
      type: e.type || 'DETECTION',
      title: e.title || '',
      description: e.description || '',
      actor: effectivePublicView ? undefined : e.actor,
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
      slaBreaches: effectivePublicView ? undefined : imp.slaBreaches,
      revenueImpact: effectivePublicView ? undefined : imp.revenueImpact,
      apiErrors: imp.apiErrors,
      performanceDegradation: imp.performanceDegradation,
    };
  };

  const timelineEvents = parseTimeline(postmortem.timeline);
  const impactMetrics = parseImpact(postmortem.impact);
  const actionItems = effectivePublicView
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

  // Infer contributing factors from rootCause text
  const getInferredFactors = (): FactorType[] => {
    const factors: FactorType[] = [];
    const text = (postmortem.rootCause || '').toLowerCase();
    if (
      text.includes('database') ||
      text.includes('server') ||
      text.includes('cpu') ||
      text.includes('memory') ||
      text.includes('network')
    ) {
      factors.push('INFRASTRUCTURE');
    }
    if (
      text.includes('bug') ||
      text.includes('null') ||
      text.includes('syntax') ||
      text.includes('release') ||
      text.includes('deploy')
    ) {
      factors.push('CODE_DEFECT');
    }
    if (
      text.includes('monitoring') ||
      text.includes('alert') ||
      text.includes('metric') ||
      text.includes('blindspot')
    ) {
      factors.push('MONITORING_GAP');
    }
    if (text.includes('runbook') || text.includes('procedure') || text.includes('handoff')) {
      factors.push('PROCESS');
    }
    if (factors.length === 0) {
      factors.push('INFRASTRUCTURE', 'CODE_DEFECT');
    }
    return factors;
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Customer Preview Mode Banner */}
      {previewAsPublic && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-amber-600" />
            <span className="font-semibold">
              Customer Preview Mode Active: Viewing redacted version shown on the Public Status
              Page.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPreviewAsPublic(false)}
            className="h-7 text-xs bg-white"
          >
            Exit Customer Preview
          </Button>
        </div>
      )}

      {/* Hero Header */}
      <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md overflow-hidden relative border-slate-200">
        <div className="absolute top-0 right-0 w-72 h-72 bg-[radial-gradient(circle,rgba(211,47,47,0.05)_0%,transparent_70%)] rounded-full translate-x-[30%] -translate-y-[30%] pointer-events-none" />

        <CardContent className="p-6 md:p-8">
          <div className="flex flex-col md:flex-row justify-between items-start gap-4 mb-4 relative z-10">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
                {isPublic ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                    <Globe className="h-3 w-3" />
                    <span>Public on Status Page</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    <span>Internal Only</span>
                  </span>
                )}
              </div>

              <h1 className="text-2xl md:text-3xl font-extrabold text-foreground tracking-tight leading-tight mb-2">
                {postmortem.title}
              </h1>

              <p className="text-sm text-muted-foreground">
                Postmortem for{' '}
                <Link
                  href={effectivePublicView ? '#' : `/incidents/${postmortem.incident.id}`}
                  className={cn(
                    'text-primary font-semibold',
                    effectivePublicView ? 'cursor-default text-muted-foreground' : 'hover:underline'
                  )}
                >
                  {postmortem.incident.title}
                </Link>
              </p>
            </div>

            {/* Action Buttons */}
            {canEdit && !initialPublicView && (
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewAsPublic(!previewAsPublic)}
                  className="h-9 gap-1.5 text-xs shadow-xs"
                >
                  {previewAsPublic ? (
                    <>
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Internal View</span>
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Preview Customer View</span>
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTogglePublic}
                  disabled={isUpdatingPublic}
                  className="h-9 gap-1.5 text-xs shadow-xs"
                >
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{isPublic ? 'Make Internal Only' : 'Publish to Status Page'}</span>
                </Button>

                <Link href={`/postmortems/${incidentId}?edit=true`}>
                  <Button size="sm" className="h-9 gap-1.5 text-xs font-semibold shadow-xs">
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit Postmortem</span>
                  </Button>
                </Link>
              </div>
            )}
          </div>

          <div className="flex gap-4 pt-4 border-t border-slate-200 text-xs text-muted-foreground flex-wrap items-center">
            <span className="flex items-center gap-1.5">
              {!effectivePublicView && postmortem.createdBy && (
                <UserAvatar
                  userId={postmortem.createdBy.id}
                  name={postmortem.createdBy.name}
                  gender={postmortem.createdBy.gender}
                  size="xs"
                />
              )}
              Created by{' '}
              <strong className="text-foreground">
                {effectivePublicView
                  ? 'Incident Response Team'
                  : postmortem.createdBy?.name || 'Responder'}
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
        <Card className="bg-white shadow-sm border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 font-bold text-foreground">
              <span className="w-1.5 h-4 bg-primary rounded-sm" />
              Executive Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
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

      {/* Root Cause Analysis & 5-Whys Diagram */}
      <Card className="bg-white shadow-sm border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 font-bold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            Root Cause Analysis & Contributing Factors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Contributing Factor Badges */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Identified Contributing Factors
            </div>
            <ContributingFactorsSelector selectedFactors={getInferredFactors()} />
          </div>

          {/* 5-Whys Diagram */}
          <div className="pt-4 border-t border-slate-100">
            <FiveWhysBuilder />
          </div>

          {/* Resolution Description */}
          {postmortem.resolution && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Mitigation & Resolution Summary
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                {postmortem.resolution}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preventative Action Items */}
      {actionItems.length > 0 && (
        <Card className="bg-white shadow-sm border-slate-200">
          <CardHeader className="pb-3">
            <div className="flex justify-between items-center">
              <CardTitle className="text-base font-bold text-foreground">
                Preventative Action Items ({completedActions}/{totalActions} Completed)
              </CardTitle>
              <div className="flex items-center gap-2">
                <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200/60">
                  <div
                    className={cn(
                      'h-full transition-all duration-300',
                      completionRate === 100 ? 'bg-emerald-500' : 'bg-primary'
                    )}
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {Math.round(completionRate)}%
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {actionItems.map(item => {
              const owner = users.find(u => u.id === item.owner);
              const statusCfg =
                ACTION_ITEM_STATUS_CONFIG[item.status as keyof typeof ACTION_ITEM_STATUS_CONFIG] ||
                ACTION_ITEM_STATUS_CONFIG.OPEN;
              const priorityCfg =
                ACTION_ITEM_PRIORITY_CONFIG[
                  item.priority as keyof typeof ACTION_ITEM_PRIORITY_CONFIG
                ] || ACTION_ITEM_PRIORITY_CONFIG.MEDIUM;

              return (
                <div
                  key={item.id}
                  className={cn(
                    'p-3.5 bg-white rounded-lg border-2 border-l-4 shadow-2xs transition-all',
                    statusCfg.border
                  )}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
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
                        <DueDateBadge
                          dueDate={item.dueDate}
                          completedAt={item.completedAt}
                          status={item.status}
                          userTimeZone={userTimeZone}
                        />
                      </div>
                      <h4 className="text-sm font-semibold text-foreground mb-1">{item.title}</h4>
                      {!effectivePublicView && (
                        <div className="mb-2">
                          <ActionItemJiraBadge
                            actionItemId={item.id}
                            externalIssue={item.externalIssue}
                            canManage={canEdit}
                            compact
                          />
                        </div>
                      )}
                      {item.description && (
                        <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
                          {item.description}
                        </p>
                      )}
                      <div className="flex gap-3 text-xs text-muted-foreground items-center">
                        {owner && (
                          <span className="flex items-center gap-1 font-medium text-foreground">
                            <UserAvatar
                              userId={owner.id}
                              name={owner.name}
                              gender={owner.gender}
                              size="xs"
                            />
                            {owner.name}
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
        <Card className="bg-white shadow-sm border-slate-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-bold text-foreground">
              Lessons Learned & Future Resiliency
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {postmortem.lessons}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
