'use client';

import { useState, useTransition } from 'react';
import {
  upsertPostmortem,
  type PostmortemData,
  type TimelineEvent,
  type ImpactMetrics,
  generatePostmortemDraft,
} from '@/app/(app)/postmortems/actions';
import { normalizeLegacyActionItems, type ActionItem } from '@/lib/action-items';
import { notify as toast } from '@/lib/toast';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Label } from '@/components/ui/shadcn/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Alert, AlertDescription } from '@/components/ui/shadcn/alert';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/shadcn/form';
import { useRouter } from 'next/navigation';
import PostmortemTimelineBuilder from './postmortem/PostmortemTimelineBuilder';
import PostmortemImpactInput from './postmortem/PostmortemImpactInput';
import PostmortemActionItems from './postmortem/PostmortemActionItems';
import { useTimezone } from '@/contexts/TimezoneContext';
import { formatDateTime } from '@/lib/timezone';
import { AlertCircle, AlertTriangle, Loader2, Wand2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { POSTMORTEM_STATUS_CONFIG } from './postmortem/shared';

const postmortemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title must be less than 100 characters'),
  summary: z.string().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  isPublic: z.boolean(),
  rootCause: z.string().optional(),
  resolution: z.string().optional(),
  lessons: z.string().optional(),
});

type PostmortemFormValues = z.infer<typeof postmortemSchema>;

type PostmortemFormProps = {
  incidentId: string;
  initialData?: {
    id: string;
    title: string;
    summary?: string | null;
    timeline?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    impact?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    rootCause?: string | null;
    resolution?: string | null;
    actionItems?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    lessons?: string | null;
    status?: string;
    isPublic?: boolean | null;
  };
  users?: Array<{ id: string; name: string; email: string }>;
  resolvedIncidents?: Array<{
    id: string;
    title: string;
    resolvedAt: Date | null;
    service: {
      name: string;
    };
  }>;
};

export default function PostmortemForm({
  incidentId,
  initialData,
  users = [],
  resolvedIncidents = [],
}: PostmortemFormProps) {
  const router = useRouter();
  const { userTimeZone } = useTimezone();
  const [isPending, startTransition] = useTransition();
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>(incidentId || '');

  // Parse initial data with proper types
  const parseTimeline = (timeline: unknown): TimelineEvent[] => {
    if (!timeline || !Array.isArray(timeline)) return [];
    return timeline.map((e: any) => ({
      id: e.id || `event-${Date.now()}-${Math.random()}`,
      timestamp: e.timestamp || new Date().toISOString(),
      type: e.type || 'DETECTION',
      title: e.title || '',
      description: e.description || '',
      actor: e.actor,
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
      slaBreaches: imp.slaBreaches,
      revenueImpact: imp.revenueImpact,
      apiErrors: imp.apiErrors,
      performanceDegradation: imp.performanceDegradation,
    };
  };

  // Setup React Hook Form
  const form = useForm<PostmortemFormValues>({
    resolver: zodResolver(postmortemSchema),
    defaultValues: {
      title: initialData?.title || '',
      summary: initialData?.summary || '',
      status: (initialData?.status as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') || 'DRAFT',
      isPublic: initialData?.isPublic ?? true,
      rootCause: initialData?.rootCause || '',
      resolution: initialData?.resolution || '',
      lessons: initialData?.lessons || '',
    },
  });

  // Complex state managed separately
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>(
    parseTimeline(initialData?.timeline)
  );
  const [impactMetrics, setImpactMetrics] = useState<ImpactMetrics>(
    parseImpact(initialData?.impact)
  );
  const [actionItems, setActionItems] = useState<ActionItem[]>(() =>
    normalizeLegacyActionItems(initialData?.actionItems, {
      legacyIdPrefix: `postmortem-${initialData?.id ?? incidentId ?? 'draft'}`,
    })
  );

  const onSubmit = (data: PostmortemFormValues) => {
    setGeneralError(null);

    const targetIncidentId = selectedIncidentId || incidentId;

    if (!targetIncidentId) {
      setGeneralError('Please select an incident');
      return;
    }

    const submitData: PostmortemData = {
      ...data,
      timeline: timelineEvents,
      impact: impactMetrics,
      actionItems: actionItems,
    };

    startTransition(async () => {
      try {
        const result = await upsertPostmortem(targetIncidentId, submitData);
        if (result.success) {
          router.push(`/postmortems/${targetIncidentId}`);
          router.refresh();
        } else {
          setGeneralError('Failed to save postmortem');
        }
      } catch (err: any) {
        setGeneralError(err.message || 'Failed to save postmortem');
      }
    });
  };

  const [isDrafting, setIsDrafting] = useState(false);

  const handleAutoDraft = async () => {
    const targetId = incidentId || selectedIncidentId;
    if (!targetId) {
      toast.error('Please select an incident first');
      return;
    }

    setIsDrafting(true);
    try {
      const draft = await generatePostmortemDraft(targetId, userTimeZone);

      // Update Form Fields
      if (draft.summary) form.setValue('summary', draft.summary, { shouldDirty: true });
      if (draft.rootCause) form.setValue('rootCause', draft.rootCause, { shouldDirty: true });
      if (draft.resolution) form.setValue('resolution', draft.resolution, { shouldDirty: true });
      if (draft.lessons) form.setValue('lessons', draft.lessons, { shouldDirty: true });

      // Update Complex State
      if (draft.timeline) setTimelineEvents(draft.timeline);
      if (draft.impact) setImpactMetrics(draft.impact);

      toast.success('Draft generated successfully');
    } catch (err: any) {
      toast.error('Failed to generate draft: ' + (err.message || 'Unknown error'));
    } finally {
      setIsDrafting(false);
    }
  };

  const selectedIncident = resolvedIncidents.find(inc => inc.id === selectedIncidentId);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Incident Selection */}
        {!incidentId && resolvedIncidents.length > 0 && (
          <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
            <CardHeader>
              <CardTitle className="text-xl">Select Incident</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <Label>Resolved Incident</Label>
                <Select value={selectedIncidentId} onValueChange={setSelectedIncidentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a resolved incident..." />
                  </SelectTrigger>
                  <SelectContent>
                    {resolvedIncidents.map(incident => (
                      <SelectItem key={incident.id} value={incident.id}>
                        {incident.title} ({incident.service.name}) - Resolved{' '}
                        {incident.resolvedAt
                          ? formatDateTime(incident.resolvedAt, userTimeZone, { format: 'date' })
                          : 'N/A'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose the incident for which you want to create a postmortem
                </p>
              </div>
              {selectedIncident && (
                <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/40 rounded-md">
                  <div className="text-sm text-muted-foreground">
                    <strong>Selected:</strong> {selectedIncident.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Service: {selectedIncident.service.name} • Resolved:{' '}
                    {selectedIncident.resolvedAt
                      ? formatDateTime(selectedIncident.resolvedAt, userTimeZone, {
                          format: 'date',
                        })
                      : 'N/A'}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Basic Information */}
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader className="flex flex-row justify-between items-center space-y-0 pb-4">
            <CardTitle className="text-xl">Basic Information</CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAutoDraft}
              disabled={isDrafting || (!incidentId && !selectedIncidentId)}
              className="bg-white hover:bg-purple-50 hover:text-purple-700 transition-colors border-purple-200"
            >
              {isDrafting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4 mr-2 text-purple-600" />
              )}
              Auto-Draft
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Database Connection Pool Exhaustion" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Executive Summary</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Provide a high-level summary for stakeholders..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Brief overview of the incident and its impact</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(POSTMORTEM_STATUS_CONFIG).map(([key, config]) => (
                          <SelectItem key={key} value={key}>
                            {config.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isPublic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Visibility</FormLabel>
                    <Select
                      onValueChange={value => field.onChange(value === 'public')}
                      defaultValue={field.value ? 'public' : 'private'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select visibility" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="public">Public (shown on status page)</SelectItem>
                        <SelectItem value="private">Private (internal only)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                    <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded flex items-start gap-2 text-sm text-yellow-800">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>Private postmortems are not shown on the public status page.</span>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Incident Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <PostmortemTimelineBuilder events={timelineEvents} onChange={setTimelineEvents} />
          </CardContent>
        </Card>

        {/* Impact Metrics */}
        <PostmortemImpactInput metrics={impactMetrics} onChange={setImpactMetrics} />

        {/* Root Cause & Resolution */}
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Analysis</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              control={form.control}
              name="rootCause"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Root Cause Analysis</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      placeholder="Describe the root cause in detail..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>What was the underlying cause of this incident?</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="resolution"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Resolution</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={4}
                      placeholder="Describe the steps taken to resolve the incident..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>How was the incident resolved?</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Action Items */}
        <PostmortemActionItems actionItems={actionItems} onChange={setActionItems} users={users} />

        {/* Lessons Learned */}
        <Card className="bg-gradient-to-br from-white to-slate-50 shadow-md">
          <CardHeader>
            <CardTitle className="text-xl">Lessons Learned</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="lessons"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lessons Learned</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={6}
                      placeholder="Document key learnings and preventive measures..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    What did we learn? How can we prevent this in the future?
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {generalError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        )}

        <div className="flex gap-3 justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {initialData ? 'Update' : 'Create'} Postmortem
          </Button>
        </div>
      </form>
    </Form>
  );
}
