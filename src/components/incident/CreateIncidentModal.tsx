'use client';

import * as React from 'react';
import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
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
  X,
  Zap,
} from 'lucide-react';

import { createIncident, getIncidentCreationContext } from '@/app/(app)/incidents/actions';
import CustomFieldInput from '@/components/CustomFieldInput';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/shadcn/avatar';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { cn } from '@/lib/utils';

type Service = { id: string; name: string };
type UserRecord = { id: string; name: string; email: string; avatarUrl?: string | null };
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
    .string({ required_error: 'Please select a service.' })
    .min(1, 'Please select a service.'),
  urgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  priority: z.string().optional(),
  assigneeId: z.string().optional(),
  dedupKey: z.string().max(200).optional(),
});

type FormValues = z.infer<typeof formSchema>;

type OpenOptions = { serviceId?: string; templateId?: string } | null;

const FIELD_LABEL_CLASS = 'text-xs font-semibold text-foreground';
const CONTROL_CLASS =
  'h-10 rounded-lg border-border/70 bg-background shadow-sm transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-primary/20';

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

    setLoading(true);
    setContextError(false);

    getIncidentCreationContext()
      .then(data => {
        if (cancelled) return;
        const ctx = data as ContextData;
        setContextData(ctx);
        setLoading(false);

        if (openOptions?.templateId) {
          const matched = ctx.templates.find(template => template.id === openOptions.templateId);
          if (matched) applyTemplate(matched);
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
      const timer = setTimeout(() => titleInputRef.current?.focus(), 100);
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

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(part => part[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();

  const services = contextData?.services || [];
  const users = contextData?.users || [];
  const teams = contextData?.teams || [];
  const templates = contextData?.templates || [];
  const customFields = contextData?.customFields || [];
  const activeTemplate = templates.find(template => template.id === selectedTemplateId);

  return (
    <DialogPrimitive.Content
      className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[94vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-2xl outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      onKeyDown={handleKeyDown}
    >
      <div className="h-1 w-full shrink-0 bg-gradient-to-r from-primary to-primary/60" />

      <div className="relative shrink-0 overflow-hidden border-b border-border/70 bg-gradient-to-br from-primary/[0.07] via-card to-card px-6 py-5">
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 shadow-sm">
              <Zap className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-bold tracking-tight text-foreground">
                Create Incident
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                Log an incident and start the response workflow.
              </DialogPrimitive.Description>
            </div>
          </div>

          <DialogPrimitive.Close className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
      </div>

      {loading && (
        <div className="flex min-h-72 flex-1 items-center justify-center px-6 py-16">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/5">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Preparing incident form</p>
              <p className="mt-1 text-xs text-muted-foreground">Loading services and responders...</p>
            </div>
          </div>
        </div>
      )}

      {!loading && (contextError || !contextData) && (
        <div className="flex min-h-72 flex-1 items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold text-foreground">Unable to load incident context</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Close this dialog and try again. No incident has been created.
            </p>
          </div>
        </div>
      )}

      {!loading && contextData && !contextData.canCreateIncident && (
        <div className="flex min-h-72 flex-1 items-center justify-center px-6 py-16">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-semibold text-foreground">Incident creation unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your current permissions do not allow incident creation.
            </p>
          </div>
        </div>
      )}

      {!loading && contextData?.canCreateIncident && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <section className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.05] via-background to-background p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <LayoutTemplate className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">Incident template</p>
                      <p className="text-[11px] text-muted-foreground">Optional · prefill common incident details</p>
                    </div>
                  </div>
                  <Link
                    href="/incidents/templates"
                    onClick={onClose}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-primary transition-opacity hover:opacity-80"
                  >
                    Manage
                    <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    value={selectedTemplateId || 'none'}
                    onValueChange={value => {
                      if (value === 'none') {
                        setSelectedTemplateId('');
                        resetForm();
                        return;
                      }

                      setSelectedTemplateId(value);
                      const template = templates.find(item => item.id === value);
                      if (template) applyTemplate(template);
                    }}
                  >
                    <SelectTrigger className={cn('flex-1 text-sm', CONTROL_CLASS)}>
                      <SelectValue placeholder="Start from scratch" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Start from scratch</SelectItem>
                      {templates.map(template => (
                        <SelectItem key={template.id} value={template.id}>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{template.name}</span>
                            {template.defaultService && (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {template.defaultService.name}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedTemplateId && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-lg px-3 text-xs"
                      onClick={() => {
                        setSelectedTemplateId('');
                        resetForm();
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>

                {activeTemplate && (
                  <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-primary/10 bg-primary/[0.04] px-3 py-2">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">{activeTemplate.name}</span> applied
                      {activeTemplate.description ? ` · ${activeTemplate.description}` : ''}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <div>
                  <p className="text-xs font-semibold text-foreground">Incident details</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Describe what is happening and the current impact.</p>
                </div>

                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className={FIELD_LABEL_CLASS}>Title</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="API latency spike in EU"
                          className={cn(CONTROL_CLASS, 'px-3.5 text-sm font-medium')}
                          {...field}
                          ref={element => {
                            field.ref(element);
                            (titleInputRef as React.MutableRefObject<HTMLInputElement | null>).current = element;
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
                      <FormLabel className={FIELD_LABEL_CLASS}>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add impact, symptoms, alerts, or any context responders should know..."
                          className="min-h-[88px] resize-y rounded-lg border-border/70 bg-background px-3.5 py-3 text-sm leading-relaxed shadow-sm transition-colors hover:border-border focus-visible:ring-2 focus-visible:ring-primary/20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              <section className="space-y-4 border-t border-border/70 pt-5">
                <div>
                  <p className="text-xs font-semibold text-foreground">Routing & impact</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Choose the affected service and how the incident should be routed.</p>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="serviceId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className={FIELD_LABEL_CLASS}>Service</FormLabel>
                        <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className={cn(CONTROL_CLASS, 'w-full justify-between px-3 text-sm font-normal')}
                              >
                                {field.value ? (
                                  <span className="flex min-w-0 items-center gap-2">
                                    <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />
                                    <span className="truncate font-medium">
                                      {services.find(service => service.id === field.value)?.name}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">Select service...</span>
                                )}
                                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
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
                                        form.setValue('serviceId', service.id, { shouldValidate: true });
                                        setServiceOpen(false);
                                      }}
                                      className="cursor-pointer"
                                    >
                                      <Check
                                        className={cn(
                                          'mr-2 h-3.5 w-3.5',
                                          service.id === field.value ? 'opacity-100' : 'opacity-0'
                                        )}
                                      />
                                      <Activity className="mr-2 h-3.5 w-3.5 text-primary" />
                                      <span>{service.name}</span>
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

                  <FormField
                    control={form.control}
                    name="assigneeId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className={FIELD_LABEL_CLASS}>Assignee</FormLabel>
                        <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                className={cn(CONTROL_CLASS, 'w-full justify-between px-3 text-sm font-normal')}
                              >
                                {field.value && field.value !== 'unassigned' ? (
                                  <span className="flex min-w-0 items-center gap-2">
                                    {field.value.startsWith('team:') ? (
                                      <>
                                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                                          <Users className="h-3 w-3" />
                                        </span>
                                        <span className="truncate font-medium">
                                          {teams.find(team => `team:${team.id}` === field.value)?.name}
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <Avatar className="h-5 w-5 shrink-0 border border-border">
                                          <AvatarImage
                                            src={
                                              users.find(
                                                user => `user:${user.id}` === field.value || user.id === field.value
                                              )?.avatarUrl || undefined
                                            }
                                          />
                                          <AvatarFallback className="bg-primary/10 text-[9px] text-primary">
                                            {getInitials(
                                              users.find(
                                                user => `user:${user.id}` === field.value || user.id === field.value
                                              )?.name || '?'
                                            )}
                                          </AvatarFallback>
                                        </Avatar>
                                        <span className="truncate font-medium">
                                          {
                                            users.find(
                                              user => `user:${user.id}` === field.value || user.id === field.value
                                            )?.name
                                          }
                                        </span>
                                      </>
                                    )}
                                  </span>
                                ) : (
                                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                    <Users className="h-3.5 w-3.5 shrink-0" />
                                    <span className="truncate">Auto-assign via escalation policy</span>
                                  </span>
                                )}
                                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-[320px] p-0" align="start">
                            <Command>
                              <CommandInput placeholder="Search users or teams..." className="h-9" />
                              <CommandList>
                                <CommandEmpty>No assignee found.</CommandEmpty>
                                <CommandGroup heading="Automatic">
                                  <CommandItem
                                    value="unassigned"
                                    onSelect={() => {
                                      form.setValue('assigneeId', 'unassigned');
                                      setAssigneeOpen(false);
                                    }}
                                    className="cursor-pointer"
                                  >
                                    <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                                    <span>Auto-assign via escalation policy</span>
                                    {field.value === 'unassigned' && <Check className="ml-auto h-3.5 w-3.5" />}
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
                                        className="cursor-pointer"
                                      >
                                        <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                                          <Users className="h-3.5 w-3.5" />
                                        </span>
                                        <span>{team.name}</span>
                                        {field.value === `team:${team.id}` && <Check className="ml-auto h-3.5 w-3.5" />}
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
                                      className="cursor-pointer"
                                    >
                                      <Avatar className="mr-2 h-6 w-6 border border-border">
                                        <AvatarImage src={user.avatarUrl || undefined} />
                                        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                                          {getInitials(user.name)}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span>{user.name}</span>
                                      {(field.value === `user:${user.id}` || field.value === user.id) && (
                                        <Check className="ml-auto h-3.5 w-3.5" />
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr]">
                  <FormField
                    control={form.control}
                    name="urgency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL_CLASS}>Urgency</FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-3 gap-2">
                            {[
                              { value: 'LOW', label: 'Low', icon: Info },
                              { value: 'MEDIUM', label: 'Medium', icon: AlertCircle },
                              { value: 'HIGH', label: 'High', icon: AlertTriangle },
                            ].map(option => {
                              const selected = field.value === option.value;
                              const Icon = option.icon;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  onClick={() => field.onChange(option.value)}
                                  className={cn(
                                    'flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-all',
                                    selected
                                      ? 'border-primary/40 bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10'
                                      : 'border-border/70 bg-background text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground'
                                  )}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                  {option.label}
                                </button>
                              );
                            })}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={FIELD_LABEL_CLASS}>Priority</FormLabel>
                        <FormControl>
                          <div className="flex h-10 items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1">
                            {['P1', 'P2', 'P3', 'P4', 'P5'].map(priority => {
                              const selected = field.value === priority;
                              return (
                                <button
                                  key={priority}
                                  type="button"
                                  onClick={() => field.onChange(selected ? '' : priority)}
                                  className={cn(
                                    'h-full flex-1 rounded-md text-[11px] font-semibold transition-all',
                                    selected
                                      ? 'bg-background text-primary shadow-sm ring-1 ring-border'
                                      : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                                  )}
                                >
                                  {priority}
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
              </section>

              <details className="group rounded-xl border border-border/70 bg-muted/20">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Advanced details</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Deduplication and routing metadata</p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>

                <div className="border-t border-border/60 px-4 py-4">
                  <FormField
                    control={form.control}
                    name="dedupKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className={cn(FIELD_LABEL_CLASS, 'flex items-center gap-1.5')}>
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          Deduplication key
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Leave empty to create without a manual key"
                            className={cn(CONTROL_CLASS, 'font-mono text-xs')}
                          />
                        </FormControl>
                        <p className="text-[11px] leading-relaxed text-muted-foreground">
                          A matching open incident is merged. A matching incident resolved within 30 minutes may be reopened.
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    Notifications, escalation, and service routing are applied automatically after creation.
                  </div>
                </div>
              </details>

              {customFields.length > 0 && (
                <section className="space-y-4 border-t border-border/70 pt-5">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Custom fields</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Additional incident metadata configured for your workspace.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                </section>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border/70 bg-muted/25 px-6 py-4">
              <div className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
                <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-mono shadow-sm">Esc</kbd>
                <span>close</span>
              </div>

              <div className="ml-auto flex items-center gap-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="h-9 px-4 text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending}
                  className="h-9 min-w-36 bg-primary px-5 font-semibold shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
                >
                  {isPending ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Zap className="h-3.5 w-3.5" />
                      Create Incident
                    </span>
                  )}
                </Button>
                <span className="hidden text-[10px] text-muted-foreground md:inline">
                  <kbd className="rounded border border-border bg-background px-1 py-0.5 font-mono shadow-sm">⌘</kbd>
                  <kbd className="ml-0.5 rounded border border-border bg-background px-1 py-0.5 font-mono shadow-sm">Enter</kbd>
                </span>
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {isOpen && (
          <CreateIncidentModalContent onClose={closeCreateIncident} openOptions={openOptions} />
        )}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
