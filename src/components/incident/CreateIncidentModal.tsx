'use client';

import * as React from 'react';
import { useState, useEffect, useActionState, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useRouter } from 'next/navigation';
import { createIncident, getIncidentCreationContext } from '@/app/(app)/incidents/actions';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import CustomFieldInput from '@/components/CustomFieldInput';
import { Button } from '@/components/ui/shadcn/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/shadcn/form';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronsUpDown,
  AlertTriangle,
  AlertCircle,
  Info,
  Activity,
  Hash,
  Users,
  Zap,
  X,
  Loader2,
  LayoutTemplate,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';

type Service = { id: string; name: string };
type UserRecord = { id: string; name: string; email: string; avatarUrl?: string | null };
type Team = { id: string; name: string };
type Template = {
  id: string;
  name: string;
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
    .string({ required_error: 'Please select a service.' })
    .min(1, 'Please select a service.'),
  urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  dedupKey: z.string().max(200).optional(),
});

type FormValues = z.infer<typeof formSchema>;

function CreateIncidentModalContent({
  onClose,
  openOptions,
}: {
  onClose: () => void;
  openOptions: { serviceId?: string; templateId?: string } | null;
}) {
  const router = useRouter();
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [contextData, setContextData] = useState<ContextData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    openOptions?.templateId || ''
  );
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [serviceOpen, setServiceOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);

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

  // Fetch context data on mount
  useEffect(() => {
    let cancelled = false;

    getIncidentCreationContext()
      .then(data => {
        if (cancelled) return;
        const ctx = data as ContextData;
        setContextData(ctx);
        setLoading(false);

        // Pre-apply template if specified in openOptions
        if (openOptions?.templateId) {
          const matched = ctx.templates.find((t: Template) => t.id === openOptions.templateId);
          if (matched) {
            applyTemplate(matched);
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openOptions, applyTemplate]);

  // Auto-focus title input once data is loaded
  useEffect(() => {
    if (contextData && !loading) {
      const timer = setTimeout(() => titleInputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [contextData, loading]);

  // Server Action State
  const [state, formAction, isPending] = useActionState(
    async (_prevState: { id: string } | null, formData: FormData) => {
      return await createIncident(formData);
    },
    null
  );

  // Handle successful creation
  useEffect(() => {
    if (state?.id) {
      onClose();
      router.push(`/incidents/${state.id}`);
    }
  }, [state, router, onClose]);

  // Custom submit handler to bridge RHF and Server Actions
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

  // Keyboard shortcut: Cmd+Enter to submit
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        form.handleSubmit(onSubmit)();
      }
    },
    [form, onSubmit]
  );

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(n => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

  const services = contextData?.services || [];
  const users = contextData?.users || [];
  const teams = contextData?.teams || [];
  const templates = contextData?.templates || [];
  const customFields = contextData?.customFields || [];

  return (
    <DialogPrimitive.Content
      className="fixed left-[50%] top-[50%] z-50 w-[92vw] max-w-3xl max-h-[88vh] translate-x-[-50%] translate-y-[-50%] rounded-2xl border border-border shadow-2xl bg-card/95 backdrop-blur-xl p-0 flex flex-col overflow-hidden gap-0 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
      onKeyDown={handleKeyDown}
    >
      {/* Decorative strip */}
      <div className="h-1.5 w-full bg-gradient-to-r from-primary via-rose-500 to-amber-500 shrink-0" />

      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-border/40 shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-primary/10 border border-primary/20">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-foreground">
                Create Incident
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-xs text-muted-foreground mt-0.5">
                Log a new incident and trigger response workflows.
              </DialogPrimitive.Description>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Template Quick-Picker */}
            {templates.length > 0 && (
              <Select
                value={selectedTemplateId}
                onValueChange={val => {
                  setSelectedTemplateId(val);
                  const template = templates.find((t: Template) => t.id === val);
                  if (template) applyTemplate(template);
                }}
              >
                <SelectTrigger className="h-8 w-[180px] text-xs bg-muted/40 border-border/50">
                  <LayoutTemplate className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Use template..." />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t: Template) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DialogPrimitive.Close className="rounded-lg p-1.5 opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex-1 flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary/60" />
            <p className="text-sm text-muted-foreground">Loading form data...</p>
          </div>
        </div>
      )}

      {/* Form body */}
      {!loading && contextData && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Intelligent Deduplication Info */}
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3.5 flex gap-3 text-sm text-yellow-600 dark:text-yellow-500">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-xs">Intelligent Merging Active</p>
                  <p className="opacity-90 text-[11px]">
                    If you use a <strong>Deduplication Key</strong> that matches an existing
                    incident:
                  </p>
                  <ul className="list-disc pl-4 text-[11px] space-y-0.5 opacity-80 mt-1">
                    <li>
                      <strong>Open Incident:</strong> Your report will be added as a note to it.
                    </li>
                    <li>
                      <strong>Recently Resolved:</strong> It will re-open the incident (if resolved
                      &lt; 30m ago).
                    </li>
                  </ul>
                </div>
              </div>

              {/* Section 1: Core Content */}
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input
                          placeholder="What's broken? e.g. API Latency Spike in EU"
                          className="text-base md:text-lg font-medium py-5 px-4 bg-background/50 border-input/50 focus:bg-background focus:ring-2 focus:ring-primary/20 transition-all duration-300 shadow-sm"
                          {...field}
                          ref={e => {
                            field.ref(e);
                            (
                              titleInputRef as React.MutableRefObject<HTMLInputElement | null>
                            ).current = e;
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
                      <FormControl>
                        <Textarea
                          placeholder="Provide context... Impact, symptoms, triggered alerts."
                          className="min-h-[80px] resize-y bg-background/50 border-input/50 focus:bg-background focus:ring-2 focus:ring-primary/20 transition-all duration-300 shadow-inner px-4 py-3 leading-relaxed text-sm"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Divider */}
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/40" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground font-semibold tracking-widest text-[10px]">
                    Context & Routing
                  </span>
                </div>
              </div>

              {/* Section 2: Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column: Routing */}
                <div className="space-y-5">
                  {/* Service Selector */}
                  <FormField
                    control={form.control}
                    name="serviceId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="text-[10px] uppercase tracking-wide text-foreground/70 font-bold mb-1.5 pl-1">
                          Affected Service
                        </FormLabel>
                        <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  'w-full justify-between h-9 bg-background/50 hover:bg-background border-dashed border-input active:scale-[0.98] transition-all text-sm',
                                  !field.value && 'text-muted-foreground'
                                )}
                              >
                                {field.value ? (
                                  <span className="flex items-center gap-2 font-medium">
                                    <Activity className="h-3.5 w-3.5 text-primary" />
                                    {services.find(s => s.id === field.value)?.name}
                                  </span>
                                ) : (
                                  'Select service...'
                                )}
                                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[var(--radix-popover-trigger-width)] p-0 shadow-xl border-border/50"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Search services..." className="h-9" />
                              <CommandList>
                                <CommandEmpty>No service found.</CommandEmpty>
                                <CommandGroup>
                                  {services.map(service => (
                                    <CommandItem
                                      value={service.name}
                                      key={service.id}
                                      onSelect={() => {
                                        form.setValue('serviceId', service.id);
                                        setServiceOpen(false);
                                      }}
                                      className="flex items-center gap-2 py-2 cursor-pointer text-sm"
                                    >
                                      <Check
                                        className={cn(
                                          'mr-1.5 h-3 w-3',
                                          service.id === field.value ? 'opacity-100' : 'opacity-0'
                                        )}
                                      />
                                      <div className="h-2 w-2 rounded-full bg-green-500 mr-1.5" />
                                      <span className="font-medium">{service.name}</span>
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

                  {/* Assignee Selector */}
                  <FormField
                    control={form.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="text-[10px] uppercase tracking-wide text-foreground/70 font-bold mb-1.5 pl-1">
                          Assignee
                        </FormLabel>
                        <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  'w-full justify-between h-9 bg-background/50 hover:bg-background border-dashed border-input active:scale-[0.98] transition-all text-sm',
                                  !field.value && 'text-muted-foreground'
                                )}
                              >
                                {field.value && field.value !== 'unassigned' ? (
                                  <span className="flex items-center gap-2 font-medium">
                                    {field.value.startsWith('team:') ? (
                                      <>
                                        <div className="h-5 w-5 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center border border-indigo-200">
                                          <Users className="h-3 w-3" />
                                        </div>
                                        {teams.find(t => `team:${t.id}` === field.value)?.name}
                                      </>
                                    ) : (
                                      <>
                                        <Avatar className="h-5 w-5 border border-slate-200">
                                          <AvatarImage
                                            src={
                                              users.find(
                                                u =>
                                                  `user:${u.id}` === field.value ||
                                                  u.id === field.value
                                              )?.avatarUrl || undefined
                                            }
                                          />
                                          <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                                            {getInitials(
                                              users.find(
                                                u =>
                                                  `user:${u.id}` === field.value ||
                                                  u.id === field.value
                                              )?.name || '?'
                                            )}
                                          </AvatarFallback>
                                        </Avatar>
                                        {
                                          users.find(
                                            u =>
                                              `user:${u.id}` === field.value || u.id === field.value
                                          )?.name
                                        }
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-2 text-muted-foreground italic">
                                    <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] border border-border">
                                      <Hash className="h-3 w-3" />
                                    </div>
                                    Auto-assign (via ELP)
                                  </span>
                                )}
                                <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[300px] p-0 shadow-xl border-border/50"
                            align="start"
                          >
                            <Command>
                              <CommandInput
                                placeholder="Search users or teams..."
                                className="h-9"
                              />
                              <CommandList>
                                <CommandEmpty>No assignee found.</CommandEmpty>
                                <CommandGroup heading="Suggestions">
                                  <CommandItem
                                    value="unassigned"
                                    onSelect={() => {
                                      form.setValue('assigneeId', 'unassigned');
                                      setAssigneeOpen(false);
                                    }}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] border border-border">
                                      <Hash className="h-3 w-3" />
                                    </div>
                                    <span>Auto-assign (via ELP)</span>
                                    {field.value === 'unassigned' && (
                                      <Check className="ml-auto h-3 w-3 opacity-100" />
                                    )}
                                  </CommandItem>
                                </CommandGroup>

                                {teams.length > 0 && (
                                  <CommandGroup heading="Teams">
                                    {teams.map(team => (
                                      <CommandItem
                                        key={team.id}
                                        value={team.name}
                                        onSelect={() => {
                                          form.setValue('assigneeId', `team:${team.id}`);
                                          setAssigneeOpen(false);
                                        }}
                                        className="flex items-center gap-2 cursor-pointer"
                                      >
                                        <div className="h-6 w-6 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center border border-indigo-200">
                                          <Users className="h-3.5 w-3.5" />
                                        </div>
                                        <span>{team.name}</span>
                                        {field.value === `team:${team.id}` && (
                                          <Check className="ml-auto h-3 w-3 opacity-100" />
                                        )}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                )}

                                <CommandGroup heading="Users">
                                  {users.map(user => (
                                    <CommandItem
                                      key={user.id}
                                      value={user.name}
                                      onSelect={() => {
                                        form.setValue('assigneeId', `user:${user.id}`);
                                        setAssigneeOpen(false);
                                      }}
                                      className="flex items-center gap-2 cursor-pointer"
                                    >
                                      <Avatar className="h-6 w-6 border border-slate-200">
                                        <AvatarImage src={user.avatarUrl || undefined} />
                                        <AvatarFallback className="text-[10px] bg-primary/10 text-primary font-bold">
                                          {getInitials(user.name)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span>{user.name}</span>
                                      {(field.value === `user:${user.id}` ||
                                        field.value === user.id) && (
                                        <Check className="ml-auto h-3 w-3 opacity-100" />
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

                {/* Right Column: Impact */}
                <div className="space-y-5">
                  {/* Urgency Cards */}
                  <FormField
                    control={form.control}
                    name="urgency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] uppercase tracking-wide text-foreground/70 font-bold mb-1.5 pl-1 block">
                          Urgency
                        </FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-3 gap-2.5">
                            {[
                              {
                                value: 'LOW',
                                label: 'Low',
                                icon: Info,
                                color: 'text-emerald-600',
                                active:
                                  'ring-2 ring-emerald-500 bg-emerald-500/5 shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)]',
                              },
                              {
                                value: 'MEDIUM',
                                label: 'Medium',
                                icon: AlertCircle,
                                color: 'text-amber-600',
                                active:
                                  'ring-2 ring-amber-500 bg-amber-500/5 shadow-[0_0_15px_-3px_rgba(245,158,11,0.3)]',
                              },
                              {
                                value: 'HIGH',
                                label: 'High',
                                icon: AlertTriangle,
                                color: 'text-rose-600',
                                active:
                                  'ring-2 ring-rose-500 bg-rose-500/5 shadow-[0_0_15px_-3px_rgba(244,63,94,0.3)]',
                              },
                            ].map(option => (
                              <div
                                key={option.value}
                                className={cn(
                                  'group cursor-pointer rounded-xl border p-2.5 transition-all duration-300 relative overflow-hidden active:scale-95',
                                  field.value === option.value
                                    ? `border-transparent ${option.active}`
                                    : 'border-input bg-background/50 hover:bg-accent hover:border-accent-foreground/30'
                                )}
                                onClick={() => field.onChange(option.value)}
                              >
                                {field.value === option.value && (
                                  <div
                                    className={cn(
                                      'absolute inset-0 opacity-10 blur-xl',
                                      option.color.replace('text-', 'bg-')
                                    )}
                                  />
                                )}
                                <div className="relative flex flex-col items-center gap-1.5">
                                  <option.icon
                                    className={cn(
                                      'h-4 w-4 transition-transform duration-300 group-hover:scale-110',
                                      option.color
                                    )}
                                  />
                                  <span
                                    className={cn(
                                      'text-[10px] font-bold tracking-wide',
                                      field.value === option.value
                                        ? option.color
                                        : 'text-muted-foreground'
                                    )}
                                  >
                                    {option.label}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Priority Selector */}
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-[10px] uppercase tracking-wide text-foreground/70 font-bold mb-1.5 pl-1 block">
                          Priority
                        </FormLabel>
                        <FormControl>
                          <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg border border-border/50">
                            {['P1', 'P2', 'P3', 'P4', 'P5'].map(p => {
                              const isSelected = field.value === p;
                              return (
                                <div
                                  key={p}
                                  onClick={() => field.onChange(isSelected ? '' : p)}
                                  className={cn(
                                    'flex-1 cursor-pointer py-1.5 text-center rounded-md text-xs font-bold transition-all duration-200 select-none',
                                    isSelected
                                      ? 'bg-background shadow-sm text-foreground ring-1 ring-border'
                                      : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                                  )}
                                >
                                  {p}
                                </div>
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

              {/* Advanced Options */}
              <div className="rounded-lg border bg-muted/20 px-4 py-3">
                <div className="flex flex-wrap gap-x-8 gap-y-4 items-center">
                  <div className="flex-1 min-w-[240px]">
                    <FormField
                      control={form.control}
                      name="dedupKey"
                      render={({ field }) => (
                        <FormItem className="space-y-1">
                          <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                            <Hash className="h-3 w-3" /> Deduplication Key
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="auto-generated-if-empty"
                              className="h-8 text-xs bg-transparent border-transparent hover:border-input focus:border-primary focus:bg-background transition-colors placeholder:text-muted-foreground/50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Info className="h-3 w-3" />
                    Notifications follow escalation and service rules automatically.
                  </div>
                </div>
              </div>

              {/* Custom Fields */}
              {customFields.length > 0 && (
                <div className="pt-2 border-t border-dashed">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 mt-2">
                    Additional Fields
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {customFields.map(field => (
                      <div key={field.id}>
                        <CustomFieldInput
                          field={field}
                          value={customFieldValues[field.id] || ''}
                          onChange={value =>
                            setCustomFieldValues(prev => ({
                              ...prev,
                              [field.id]: value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-muted/30 border-t flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="text-muted-foreground hover:text-foreground hover:bg-background"
                >
                  Cancel
                </Button>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  <kbd className="font-mono bg-muted border border-border/50 px-1 rounded text-[9px]">
                    Esc
                  </kbd>{' '}
                  to close
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  <kbd className="font-mono bg-muted border border-border/50 px-1 rounded text-[9px]">
                    ⌘
                  </kbd>
                  <kbd className="font-mono bg-muted border border-border/50 px-1 rounded text-[9px] ml-0.5">
                    Enter
                  </kbd>{' '}
                  to submit
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  className={cn(
                    'px-6 font-semibold shadow-lg transition-all duration-300',
                    isPending ? 'opacity-80' : 'hover:shadow-primary/20 hover:scale-[1.02]'
                  )}
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating...
                    </span>
                  ) : (
                    'Create Incident'
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {isOpen && (
          <CreateIncidentModalContent onClose={closeCreateIncident} openOptions={openOptions} />
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
