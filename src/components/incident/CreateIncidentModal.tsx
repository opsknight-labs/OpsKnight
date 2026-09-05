'use client';

import * as React from 'react';
import { useActionState, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useForm } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as z from 'zod';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Hash,
  Info,
  LayoutTemplate,
  Loader2,
  Users,
  User as UserIcon,
  ShieldAlert,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';

import { createIncident, getIncidentCreationContext } from '@/app/(app)/incidents/actions';
import CustomFieldInput from '@/components/CustomFieldInput';
import UserAvatar from '@/components/UserAvatar';
import StatusBadge from '@/components/incident/StatusBadge';
import PriorityBadge from '@/components/incident/PriorityBadge';
import { Badge } from '@/components/ui/shadcn/badge';
import { Button } from '@/components/ui/shadcn/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/shadcn/form';
import { Input } from '@/components/ui/shadcn/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { cn } from '@/lib/utils';

type Service = { id: string; name: string };
type UserRecord = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
  gender?: string | null;
};
type Team = { id: string; name: string };
type Template = {
  id: string;
  name: string;
  description?: string | null;
  title: string;
  descriptionText?: string | null;
  defaultUrgency: 'HIGH' | 'MEDIUM' | 'LOW';
  defaultPriority?: string | null;
  defaultService?: { id: string; name: string } | null;
};
type CustomField = {
  id: string;
  name: string;
  key: string;
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
  required: boolean;
  defaultValue?: string | null;
  options?: unknown;
};

type ContextData = {
  canCreateIncident: boolean;
  services: Service[];
  users: UserRecord[];
  teams: Team[];
  customFields: CustomField[];
  templates: Template[];
};

const formSchema = z.object({
  title: z.string().min(5, { message: 'Title must be at least 5 characters.' }).max(255),
  description: z.string().optional(),
  serviceId: z
    .string({ required_error: 'Please select an affected service.' })
    .min(1, 'Please select an affected service.'),
  urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  dedupKey: z.string().max(200).optional(),
});

type FormValues = z.infer<typeof formSchema>;
type OpenOptions = { serviceId?: string; templateId?: string } | null;

const FIELD_LABEL_CLASS = 'text-xs font-semibold text-foreground flex items-center justify-between';
const CONTROL_CLASS =
  'h-10 rounded-xl border-border/80 bg-background shadow-2xs transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-primary/20';

const URGENCY_OPTIONS = [
  {
    value: 'HIGH' as const,
    label: 'High',
    sublabel: 'Immediate Paging',
    desc: 'Alerts on-call responders immediately via phone, SMS, and push',
    icon: Zap,
    selectedClass:
      'border-rose-500/50 bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30 shadow-2xs dark:text-rose-300',
    idleClass:
      'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-rose-500',
    badgeVariant: 'danger' as const,
  },
  {
    value: 'MEDIUM' as const,
    label: 'Medium',
    sublabel: 'Standard Triage',
    desc: 'Notifies responders during active working hours',
    icon: AlertCircle,
    selectedClass:
      'border-amber-500/50 bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30 shadow-2xs dark:text-amber-300',
    idleClass:
      'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-amber-500',
    badgeVariant: 'warning' as const,
  },
  {
    value: 'LOW' as const,
    label: 'Low',
    sublabel: 'Non-Urgent',
    desc: 'No immediate page. Queued for standard backlog review',
    icon: Info,
    selectedClass:
      'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 shadow-2xs dark:text-emerald-300',
    idleClass:
      'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-emerald-500',
    badgeVariant: 'neutral' as const,
  },
];

const PRIORITY_OPTIONS = [
  {
    value: 'P1',
    label: 'Crisis',
    description: 'Critical service outage affecting all customers',
    selectedClass:
      'bg-rose-500/15 text-rose-700 border-rose-500/40 ring-1 ring-rose-500/30 shadow-2xs dark:text-rose-300',
    dotClass: 'bg-rose-500',
  },
  {
    value: 'P2',
    label: 'High',
    description: 'Major functionality degraded with significant impact',
    selectedClass:
      'bg-orange-500/15 text-orange-700 border-orange-500/40 ring-1 ring-orange-500/30 shadow-2xs dark:text-orange-300',
    dotClass: 'bg-orange-500',
  },
  {
    value: 'P3',
    label: 'Medium',
    description: 'Partial degradation or non-critical feature impaired',
    selectedClass:
      'bg-amber-500/15 text-amber-700 border-amber-500/40 ring-1 ring-amber-500/30 shadow-2xs dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  {
    value: 'P4',
    label: 'Low',
    description: 'Minor issue with reasonable workaround available',
    selectedClass:
      'bg-sky-500/15 text-sky-700 border-sky-500/40 ring-1 ring-sky-500/30 shadow-2xs dark:text-sky-300',
    dotClass: 'bg-sky-500',
  },
  {
    value: 'P5',
    label: 'Info',
    description: 'Planned maintenance or informational operational notice',
    selectedClass:
      'bg-slate-500/15 text-slate-700 border-slate-500/40 ring-1 ring-slate-500/30 shadow-2xs dark:text-slate-300',
    dotClass: 'bg-slate-400',
  },
];

const QUICK_SNIPPETS = [
  { label: '+ Symptoms', snippet: '\n\n**Symptoms:**\n- ' },
  { label: '+ Impact', snippet: '\n\n**Customer Impact:**\n- ' },
  { label: '+ Mitigation', snippet: '\n\n**Mitigation Steps:**\n- ' },
];

function CreateIncidentModalContent({
  onClose,
  openOptions,
}: {
  onClose: () => void;
  openOptions: OpenOptions;
}) {
  const router = useRouter();
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(true);
  const [contextError, setContextError] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(openOptions?.templateId || '');
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [serviceOpen, setServiceOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
      serviceId: openOptions?.serviceId || '',
      urgency: 'HIGH',
      priority: '',
      assigneeId: 'unassigned',
      dedupKey: '',
    },
  });

  const watchedTitle = form.watch('title');
  const watchedServiceId = form.watch('serviceId');
  const watchedUrgency = form.watch('urgency');
  const watchedPriority = form.watch('priority');
  const watchedAssigneeId = form.watch('assigneeId');

  const resetForm = useCallback(() => {
    form.reset({
      title: '',
      description: '',
      serviceId: openOptions?.serviceId || '',
      urgency: 'HIGH',
      priority: '',
      assigneeId: 'unassigned',
      dedupKey: '',
    });
  }, [form, openOptions?.serviceId]);

  const applyTemplate = useCallback(
    (template: Template) => {
      form.reset({
        title: template.title,
        description: template.descriptionText || '',
        serviceId: template.defaultService?.id || '',
        urgency: template.defaultUrgency,
        priority: template.defaultPriority || '',
        assigneeId: 'unassigned',
        dedupKey: '',
      });
    },
    [form]
  );

  useEffect(() => {
    let cancelled = false;

    getIncidentCreationContext()
      .then(data => {
        if (cancelled) return;
        const ctx = data as ContextData;
        setContextData(ctx);
        setLoading(false);

        if (openOptions?.templateId) {
          const matched = ctx.templates.find(template => template.id === openOptions.templateId);
          if (matched) {
            setSelectedTemplateId(matched.id);
            applyTemplate(matched);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setContextError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyTemplate, openOptions]);

  useEffect(() => {
    if (contextData && !loading) {
      const timer = setTimeout(() => titleInputRef.current?.focus(), 60);
      return () => clearTimeout(timer);
    }
  }, [contextData, loading]);

  const [state, formAction, isPending] = useActionState(
    async (_prevState: { id: string } | null, formData: FormData) => {
      return await createIncident(formData);
    },
    null
  );

  useEffect(() => {
    if (state?.id) {
      onClose();
      router.push(`/incidents/${state.id}`);
    }
  }, [state, router, onClose]);

  const onSubmit = useCallback(
    (data: FormValues) => {
      const formData = new FormData();
      formData.append('title', data.title);
      formData.append('description', data.description || '');
      formData.append('serviceId', data.serviceId);
      formData.append('urgency', data.urgency);
      if (data.priority) formData.append('priority', data.priority);

      if (data.assigneeId && data.assigneeId !== 'unassigned') {
        if (data.assigneeId.startsWith('team:')) {
          formData.append('teamId', data.assigneeId.replace('team:', ''));
        } else if (data.assigneeId.startsWith('user:')) {
          formData.append('assigneeId', data.assigneeId.replace('user:', ''));
        } else {
          formData.append('assigneeId', data.assigneeId);
        }
      }

      if (data.dedupKey) formData.append('dedupKey', data.dedupKey);

      Object.entries(customFieldValues).forEach(([key, value]) => {
        formData.append(`customField_${key}`, value);
      });

      React.startTransition(() => {
        formAction(formData);
      });
    },
    [customFieldValues, formAction]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        form.handleSubmit(onSubmit)();
      }
    },
    [form, onSubmit]
  );

  const services = useMemo(() => contextData?.services || [], [contextData?.services]);
  const users = useMemo(() => contextData?.users || [], [contextData?.users]);
  const teams = useMemo(() => contextData?.teams || [], [contextData?.teams]);
  const templates = useMemo(() => contextData?.templates || [], [contextData?.templates]);
  const customFields = useMemo(() => contextData?.customFields || [], [contextData?.customFields]);

  const selectedService = useMemo(
    () => services.find(s => s.id === watchedServiceId),
    [services, watchedServiceId]
  );

  const selectedAssigneeUser = useMemo(
    () => users.find(u => watchedAssigneeId === `user:${u.id}` || watchedAssigneeId === u.id),
    [users, watchedAssigneeId]
  );

  const selectedAssigneeTeam = useMemo(
    () => teams.find(t => watchedAssigneeId === `team:${t.id}` || watchedAssigneeId === t.id),
    [teams, watchedAssigneeId]
  );

  const selectedPriorityConfig = useMemo(
    () => PRIORITY_OPTIONS.find(p => p.value === watchedPriority),
    [watchedPriority]
  );

  const appendSnippet = (snippet: string) => {
    const current = form.getValues('description') || '';
    form.setValue('description', current + snippet, { shouldValidate: true });
  };

  return (
    <DialogPrimitive.Content
      className="fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[95vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card text-card-foreground shadow-2xl outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      onKeyDown={handleKeyDown}
    >
      {/* Top Accent Bar */}
      <div className="h-1 w-full shrink-0 bg-gradient-to-r from-primary via-primary/80 to-primary/40" />

      {/* Header */}
      <div className="relative shrink-0 border-b border-border/70 bg-gradient-to-b from-muted/30 to-background/50 px-5 sm:px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-2xs">
              <Zap className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogPrimitive.Title className="text-base sm:text-lg font-bold tracking-tight text-foreground">
                  Declare Incident
                </DialogPrimitive.Title>
                <Badge variant="neutral" size="xs" className="text-[10px] font-semibold uppercase">
                  Triage Mode
                </Badge>
              </div>
              <DialogPrimitive.Description className="text-xs text-muted-foreground truncate">
                Notify on-call responders and initiate structured incident resolution.
              </DialogPrimitive.Description>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/70 bg-muted/50 border border-border/60 px-1.5 py-0.5 rounded">
              Esc
            </span>
            <DialogPrimitive.Close
              aria-label="Close create incident dialog"
              title="Close (Esc)"
              className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground transition-all hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4 transition-transform group-hover:rotate-90" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        </div>
      </div>

      {/* Skeleton / Zero Layout Shift Loader */}
      {loading && (
        <div className="flex-1 space-y-6 overflow-y-auto px-5 sm:px-6 py-6 animate-pulse">
          <div className="h-14 rounded-xl bg-muted/50 border border-border/60" />
          <div className="space-y-2">
            <div className="h-4 w-28 bg-muted rounded" />
            <div className="h-10 rounded-xl bg-muted/60" />
          </div>
          <div className="space-y-2">
            <div className="h-4 w-32 bg-muted rounded" />
            <div className="h-24 rounded-xl bg-muted/60" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 rounded-xl bg-muted/60" />
            <div className="h-10 rounded-xl bg-muted/60" />
          </div>
          <div className="h-10 rounded-xl bg-muted/60" />
        </div>
      )}

      {/* Error state */}
      {!loading && (contextError || !contextData) && (
        <div className="flex min-h-72 flex-1 items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto h-7 w-7 text-amber-500" />
            <p className="mt-3 text-sm font-semibold text-foreground">
              Unable to load incident context
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Could not retrieve workspace services or responder details. Please close and try
              again.
            </p>
            <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Permission denied */}
      {!loading && contextData && !contextData.canCreateIncident && (
        <div className="flex min-h-72 flex-1 items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center">
            <ShieldAlert className="mx-auto h-7 w-7 text-rose-500" />
            <p className="mt-3 text-sm font-semibold text-foreground">
              Incident creation restricted
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your current account role does not have operational permissions to declare incidents.
            </p>
            <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
              Close
            </Button>
          </div>
        </div>
      )}

      {/* Form Content */}
      {!loading && contextData?.canCreateIncident && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-5 sm:px-6 py-5">
              {/* Template Switcher Bar */}
              {templates.length > 0 && (
                <div className="rounded-xl border border-border/80 bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-2 px-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <LayoutTemplate className="h-3.5 w-3.5 text-primary" />
                      <span>Incident Templates</span>
                    </div>
                    <Link
                      href="/incidents/templates"
                      onClick={onClose}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                    >
                      Manage
                      <ArrowUpRight className="h-3 w-3" />
                    </Link>
                  </div>

                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTemplateId('');
                        resetForm();
                      }}
                      className={cn(
                        'shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
                        !selectedTemplateId
                          ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                          : 'bg-background border-border/70 text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Start from scratch
                    </button>

                    {templates.map(tpl => {
                      const isActive = selectedTemplateId === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          type="button"
                          onClick={() => {
                            setSelectedTemplateId(tpl.id);
                            applyTemplate(tpl);
                          }}
                          className={cn(
                            'shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all',
                            isActive
                              ? 'bg-primary/10 border-primary/40 text-primary font-semibold shadow-2xs'
                              : 'bg-background border-border/70 text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {isActive && <Check className="h-3 w-3 text-primary shrink-0" />}
                          <span>{tpl.name}</span>
                          {tpl.defaultService && (
                            <span className="text-[10px] opacity-70 bg-muted px-1 rounded">
                              {tpl.defaultService.name}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Title & Description Section */}
              <div className="space-y-3.5">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={FIELD_LABEL_CLASS}>
                        <span>
                          Incident Title <span className="text-rose-500">*</span>
                        </span>
                        <span className="text-[10px] font-normal text-muted-foreground tabular-nums">
                          {field.value?.length || 0}/255
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Primary database connection pool exhausted in EU-West"
                          className={cn(CONTROL_CLASS, 'px-3.5 text-sm font-medium')}
                          {...field}
                          ref={element => {
                            field.ref(element);
                            (
                              titleInputRef as React.MutableRefObject<HTMLInputElement | null>
                            ).current = element;
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel className={FIELD_LABEL_CLASS}>
                          <span>Summary & Context</span>
                        </FormLabel>
                        <div className="flex items-center gap-1.5">
                          {QUICK_SNIPPETS.map(snip => (
                            <button
                              key={snip.label}
                              type="button"
                              onClick={() => appendSnippet(snip.snippet)}
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                            >
                              {snip.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <FormControl>
                        <Textarea
                          placeholder="Provide details on user impact, active symptoms, error rates, and initial hypotheses..."
                          className="min-h-[80px] resize-y rounded-xl border-border/80 bg-background px-3.5 py-2.5 text-sm leading-relaxed shadow-2xs transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-primary/20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Service and Assignee Routing */}
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 pt-1 border-t border-border/60">
                {/* Affected Service */}
                <FormField
                  control={form.control}
                  name="serviceId"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className={FIELD_LABEL_CLASS}>
                        <span>
                          Affected Service <span className="text-rose-500">*</span>
                        </span>
                      </FormLabel>
                      <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className={cn(
                                CONTROL_CLASS,
                                'w-full justify-between px-3 text-sm font-normal'
                              )}
                            >
                              {field.value ? (
                                <span className="flex min-w-0 items-center gap-2">
                                  <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="truncate font-semibold text-foreground">
                                    {selectedService?.name || 'Selected'}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground flex items-center gap-1.5">
                                  <Activity className="h-3.5 w-3.5 opacity-50" />
                                  Select affected service...
                                </span>
                              )}
                              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] p-0"
                          align="start"
                        >
                          <Command>
                            <CommandInput placeholder="Search services..." className="h-9" />
                            <CommandList>
                              <CommandEmpty>No service found.</CommandEmpty>
                              <CommandGroup>
                                {services.map(service => (
                                  <CommandItem
                                    key={service.id}
                                    value={service.name}
                                    onSelect={() => {
                                      form.setValue('serviceId', service.id, {
                                        shouldValidate: true,
                                      });
                                      setServiceOpen(false);
                                    }}
                                    className="cursor-pointer flex items-center justify-between"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Activity className="h-3.5 w-3.5 text-primary shrink-0" />
                                      <span className="truncate font-medium">{service.name}</span>
                                    </div>
                                    {service.id === field.value && (
                                      <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Assignee / Responder */}
                <FormField
                  control={form.control}
                  name="assigneeId"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel className={FIELD_LABEL_CLASS}>
                        <span>Responder Assignment</span>
                      </FormLabel>
                      <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className={cn(
                                CONTROL_CLASS,
                                'w-full justify-between px-3 text-sm font-normal'
                              )}
                            >
                              {field.value && field.value !== 'unassigned' ? (
                                <span className="flex min-w-0 items-center gap-2">
                                  {selectedAssigneeTeam ? (
                                    <>
                                      <div className="h-5 w-5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                                        <Users className="h-2.5 w-2.5" />
                                      </div>
                                      <span className="truncate font-medium text-foreground">
                                        {selectedAssigneeTeam.name}
                                      </span>
                                    </>
                                  ) : selectedAssigneeUser ? (
                                    <>
                                      <UserAvatar
                                        userId={selectedAssigneeUser.id}
                                        name={selectedAssigneeUser.name}
                                        gender={selectedAssigneeUser.gender}
                                        avatarUrl={selectedAssigneeUser.avatarUrl}
                                        size="xs"
                                        className="border-border"
                                      />
                                      <span className="truncate font-medium text-foreground">
                                        {selectedAssigneeUser.name}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="truncate font-medium">Assigned</span>
                                  )}
                                </span>
                              ) : (
                                <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-primary" />
                                  <span className="truncate">Auto-assign (Escalation Policy)</span>
                                </span>
                              )}
                              <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[320px] p-0" align="start">
                          <Command>
                            <CommandInput
                              placeholder="Search responders or teams..."
                              className="h-9"
                            />
                            <CommandList>
                              <CommandEmpty>No responder found.</CommandEmpty>
                              <CommandGroup heading="Automatic Routing">
                                <CommandItem
                                  value="unassigned auto-assign escalation policy"
                                  onSelect={() => {
                                    form.setValue('assigneeId', 'unassigned');
                                    setAssigneeOpen(false);
                                  }}
                                  className="cursor-pointer"
                                >
                                  <ShieldAlert className="mr-2 h-4 w-4 text-primary" />
                                  <div className="flex flex-col">
                                    <span className="font-semibold text-xs">
                                      Auto-assign via Policy
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      Pages on-call responders bound to service
                                    </span>
                                  </div>
                                  {field.value === 'unassigned' && (
                                    <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                                  )}
                                </CommandItem>
                              </CommandGroup>

                              {teams.length > 0 && (
                                <CommandGroup heading="Teams">
                                  {teams.map(team => (
                                    <CommandItem
                                      key={team.id}
                                      value={`team ${team.name}`}
                                      onSelect={() => {
                                        form.setValue('assigneeId', `team:${team.id}`);
                                        setAssigneeOpen(false);
                                      }}
                                      className="cursor-pointer"
                                    >
                                      <span className="mr-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                                        <Users className="h-3 w-3" />
                                      </span>
                                      <span className="font-medium text-xs">{team.name}</span>
                                      {field.value === `team:${team.id}` && (
                                        <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                                      )}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              )}

                              <CommandGroup heading="Direct Responders">
                                {users.map(user => (
                                  <CommandItem
                                    key={user.id}
                                    value={`user ${user.name} ${user.email}`}
                                    onSelect={() => {
                                      form.setValue('assigneeId', `user:${user.id}`);
                                      setAssigneeOpen(false);
                                    }}
                                    className="cursor-pointer"
                                  >
                                    <UserAvatar
                                      userId={user.id}
                                      name={user.name}
                                      gender={user.gender}
                                      avatarUrl={user.avatarUrl}
                                      size="xs"
                                      className="mr-2 border-border"
                                    />
                                    <div className="flex flex-col min-w-0">
                                      <span className="font-medium text-xs truncate">
                                        {user.name}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground truncate">
                                        {user.email}
                                      </span>
                                    </div>
                                    {(field.value === `user:${user.id}` ||
                                      field.value === user.id) && (
                                      <Check className="ml-auto h-3.5 w-3.5 text-primary shrink-0" />
                                    )}
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Urgency & Priority */}
              <div className="space-y-3 pt-1 border-t border-border/60">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Urgency */}
                  <FormField
                    control={form.control}
                    name="urgency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL_CLASS}>
                          <span>Urgency (Paging Speed)</span>
                        </FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-3 gap-1.5">
                            {URGENCY_OPTIONS.map(option => {
                              const selected = field.value === option.value;
                              const Icon = option.icon;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => field.onChange(option.value)}
                                  className={cn(
                                    'flex flex-col items-center justify-center p-2 rounded-xl border text-center transition-all cursor-pointer',
                                    selected ? option.selectedClass : option.idleClass
                                  )}
                                  title={option.desc}
                                >
                                  <Icon className={cn('h-3.5 w-3.5 mb-1', option.iconClass)} />
                                  <span className="text-xs font-bold leading-tight">
                                    {option.label}
                                  </span>
                                  <span className="text-[9px] opacity-75 font-normal leading-tight mt-0.5">
                                    {option.sublabel}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Priority */}
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL_CLASS}>
                          <span>Priority (Severity)</span>
                          {selectedPriorityConfig && (
                            <span className="text-[10px] font-normal text-muted-foreground">
                              {selectedPriorityConfig.label}
                            </span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-5 gap-1.5">
                            {PRIORITY_OPTIONS.map(p => {
                              const selected = field.value === p.value;
                              return (
                                <button
                                  key={p.value}
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => field.onChange(selected ? '' : p.value)}
                                  className={cn(
                                    'flex flex-col items-center justify-center p-2 rounded-xl border transition-all cursor-pointer',
                                    selected
                                      ? p.selectedClass
                                      : 'border-border/80 bg-card hover:bg-muted/50 hover:border-border text-muted-foreground'
                                  )}
                                  title={`${p.value} (${p.label}): ${p.description}`}
                                >
                                  <span
                                    className={cn('h-1.5 w-1.5 rounded-full mb-1', p.dotClass)}
                                  />
                                  <span className="text-xs font-bold leading-tight">{p.value}</span>
                                  <span className="text-[9px] opacity-75 font-normal leading-tight mt-0.5">
                                    {p.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Live Incident Card Preview */}
              <div className="rounded-xl border border-border/80 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>Live Incident Card Preview</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPreview(prev => !prev)}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    {showPreview ? 'Hide' : 'Show'}
                  </button>
                </div>

                {showPreview && (
                  <div className="group relative rounded-2xl border bg-card transition-all duration-150 overflow-hidden shadow-2xs border-border">
                    {/* Status accent bar matching IncidentsListTable */}
                    <div className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-rose-500 opacity-80" />

                    <div className="flex gap-3 items-center pl-4 pr-3.5 py-3 md:py-3.5">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-sm text-foreground leading-snug truncate block">
                            {watchedTitle || 'Untitled Incident'}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <StatusBadge status="OPEN" size="sm" showDot />
                            {watchedPriority && (
                              <PriorityBadge priority={watchedPriority} size="sm" />
                            )}
                            <Badge
                              variant={
                                watchedUrgency === 'HIGH'
                                  ? 'danger'
                                  : watchedUrgency === 'MEDIUM'
                                    ? 'warning'
                                    : 'neutral'
                              }
                              size="xs"
                              className="uppercase"
                            >
                              {watchedUrgency}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-primary">
                            {selectedService?.name || 'No service selected'}
                          </span>
                          <span className="opacity-40">&middot;</span>
                          <span className="font-mono text-muted-foreground/80">#PREVIEW</span>
                          <span className="opacity-40">&middot;</span>
                          <span>Just now</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 pl-1">
                        {selectedAssigneeUser ? (
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-muted/40 border border-border/70 text-[11px] font-medium text-foreground">
                            <UserAvatar
                              userId={selectedAssigneeUser.id}
                              name={selectedAssigneeUser.name}
                              gender={selectedAssigneeUser.gender}
                              avatarUrl={selectedAssigneeUser.avatarUrl}
                              size="xs"
                              className="border-border"
                            />
                            <span className="truncate max-w-[90px]">
                              {selectedAssigneeUser.name.split(' ')[0]}
                            </span>
                          </div>
                        ) : selectedAssigneeTeam ? (
                          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-800/40 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                            <Users className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                            <span className="truncate max-w-[90px]">
                              {selectedAssigneeTeam.name}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70 px-1">
                            <UserIcon className="h-3 w-3 opacity-60" />
                            <span>Auto-routed</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Advanced Accordion: Dedup Key & Custom Fields */}
              <details className="group rounded-xl border border-border/80 bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Advanced Options</p>
                    <p className="text-[11px] text-muted-foreground">
                      Alert deduplication key & workspace custom fields
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>

                <div className="border-t border-border/70 px-4 py-3.5 space-y-4">
                  <FormField
                    control={form.control}
                    name="dedupKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={cn(FIELD_LABEL_CLASS, 'flex items-center gap-1.5')}>
                          <span className="flex items-center gap-1.5">
                            <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                            Deduplication Key
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Optional: e.g. billing-checkout-db-high-latency"
                            className={cn(CONTROL_CLASS, 'font-mono text-xs')}
                          />
                        </FormControl>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          Matching open incidents will be merged. Resolved incidents within 30
                          minutes may be automatically reopened.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {customFields.length > 0 && (
                    <div className="space-y-3 pt-2 border-t border-border/60">
                      <p className="text-xs font-semibold text-foreground">
                        Workspace Custom Fields
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {customFields.map(field => (
                          <CustomFieldInput
                            key={field.id}
                            field={field}
                            value={customFieldValues[field.id] || ''}
                            onChange={value =>
                              setCustomFieldValues(previous => ({
                                ...previous,
                                [field.id]: value,
                              }))
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>

            {/* Sticky Action Footer */}
            <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-4 border-t border-border/80 bg-card/95 backdrop-blur-sm px-5 sm:px-6 py-3.5">
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] shadow-2xs">
                    ⌘
                  </kbd>
                  <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] shadow-2xs">
                    Enter
                  </kbd>
                </span>
                <span>to create</span>
              </div>

              <div className="ml-auto flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-9 px-4 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  className="h-9 min-w-36 bg-primary px-5 font-semibold text-xs shadow-sm transition-all hover:bg-primary/90 hover:shadow-md cursor-pointer"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Publishing Incident...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      Create Incident
                    </span>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      )}
    </DialogPrimitive.Content>
  );
}

export default function CreateIncidentModal() {
  const { isOpen, openOptions, closeCreateIncident } = useCreateIncidentModal();

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeCreateIncident();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {isOpen && (
          <CreateIncidentModalContent onClose={closeCreateIncident} openOptions={openOptions} />
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
