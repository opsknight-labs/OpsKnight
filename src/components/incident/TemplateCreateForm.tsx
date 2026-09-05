'use client';

import * as React from 'react';
import { useState, useActionState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import Link from 'next/link';
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
import { Badge } from '@/components/ui/shadcn/badge';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronsUpDown,
  Zap,
  AlertCircle,
  Info,
  Layers,
  FileText,
  Globe,
  Lock,
  Server,
  Eye,
  PenLine,
  Sparkles,
  Loader2,
  Lightbulb,
} from 'lucide-react';

// Types
type Service = {
  id: string;
  name: string;
};

type TemplateCreateFormProps = {
  services: Service[];
  action: (prevState: null, formData: FormData) => Promise<null>;
};

// Zod Schema
const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().optional(),
  title: z.string().min(5, 'Default Title must be at least 5 characters').max(255),
  descriptionText: z.string().optional(),
  defaultUrgency: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  defaultPriority: z.string().optional(),
  defaultServiceId: z.string().optional(),
  isPublic: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

const URGENCY_OPTIONS = [
  {
    value: 'HIGH' as const,
    label: 'High Urgency',
    sublabel: 'Immediate Paging',
    desc: 'Alerts on-call responders immediately via their configured notification channels',
    icon: Zap,
    selectedClass:
      'border-rose-500/50 bg-rose-500/10 text-rose-700 ring-1 ring-rose-500/30 shadow-2xs dark:text-rose-300',
    idleClass:
      'border-border/80 bg-background/50 hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-rose-500',
    badgeVariant: 'text-rose-700 bg-rose-500/10 border-rose-500/30 dark:text-rose-300',
  },
  {
    value: 'MEDIUM' as const,
    label: 'Medium Urgency',
    sublabel: 'Standard Triage',
    desc: 'Pages on-call responders via their configured notification preferences',
    icon: AlertCircle,
    selectedClass:
      'border-amber-500/50 bg-amber-500/10 text-amber-700 ring-1 ring-amber-500/30 shadow-2xs dark:text-amber-300',
    idleClass:
      'border-border/80 bg-background/50 hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-amber-500',
    badgeVariant: 'text-amber-700 bg-amber-500/10 border-amber-500/30 dark:text-amber-300',
  },
  {
    value: 'LOW' as const,
    label: 'Low Urgency',
    sublabel: 'Non-Urgent',
    desc: 'Queued for standard triage review without active paging alerts',
    icon: Info,
    selectedClass:
      'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/30 shadow-2xs dark:text-emerald-300',
    idleClass:
      'border-border/80 bg-background/50 hover:bg-muted/50 hover:border-border text-muted-foreground',
    iconClass: 'text-emerald-500',
    badgeVariant: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-300',
  },
];

const PRIORITY_OPTIONS = [
  {
    value: 'P1',
    label: 'P1',
    title: 'Crisis / Critical Outage',
    activeClass: 'bg-rose-500 text-white border-rose-500',
  },
  {
    value: 'P2',
    label: 'P2',
    title: 'Major Service Degradation',
    activeClass: 'bg-orange-500 text-white border-orange-500',
  },
  {
    value: 'P3',
    label: 'P3',
    title: 'Moderate / Partial Degradation',
    activeClass: 'bg-amber-500 text-white border-amber-500',
  },
  {
    value: 'P4',
    label: 'P4',
    title: 'Minor / Low Impact',
    activeClass: 'bg-blue-600 text-white border-blue-600',
  },
  {
    value: 'P5',
    label: 'P5',
    title: 'Informational / Cosmetic',
    activeClass: 'bg-slate-600 text-white border-slate-600',
  },
];

function parseInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code
          key={match.index}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground border border-border/60"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('[') && token.includes('](')) {
      const closeBracket = token.indexOf('](');
      const label = token.slice(1, closeBracket);
      parts.push(
        <span key={match.index} className="text-primary underline font-medium">
          {label}
        </span>
      );
    }
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length > 0 ? parts : text;
}

function renderMarkdown(content: string): React.ReactNode {
  if (!content.trim()) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center text-xs text-muted-foreground">
        <FileText className="h-5 w-5 mb-1.5 opacity-40" />
        <p className="font-medium">No description preview</p>
        <p className="text-[11px] opacity-75 mt-0.5">
          Type incident guidance, runbook steps, or checklists in the Write tab.
        </p>
      </div>
    );
  }

  const lines = content.split('\n');
  return (
    <div className="space-y-1.5 text-xs text-foreground/90 leading-relaxed">
      {lines.map((line, idx) => {
        if (!line.trim()) return <div key={idx} className="h-1.5" />;
        if (line.startsWith('### ')) {
          return (
            <h4 key={idx} className="text-xs font-bold text-foreground mt-2">
              {parseInlineMarkdown(line.slice(4))}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={idx} className="text-sm font-bold text-foreground mt-2">
              {parseInlineMarkdown(line.slice(3))}
            </h3>
          );
        }
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-2">
              <span className="text-muted-foreground mt-1">&bull;</span>
              <span>{parseInlineMarkdown(line.slice(2))}</span>
            </div>
          );
        }
        return <p key={idx}>{parseInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

export default function TemplateCreateForm({ services, action }: TemplateCreateFormProps) {
  const [descTab, setDescTab] = useState<'write' | 'preview'>('write');
  const [serviceOpen, setServiceOpen] = useState(false);

  // Form definition
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      title: '',
      descriptionText: '',
      defaultUrgency: 'HIGH',
      defaultPriority: 'P1',
      defaultServiceId: '',
      isPublic: true,
    },
  });

  // Watched values for live preview
  const watchedName = form.watch('name');
  const watchedTitle = form.watch('title');
  const watchedUrgency = form.watch('defaultUrgency');
  const watchedPriority = form.watch('defaultPriority');
  const watchedServiceId = form.watch('defaultServiceId');
  const watchedIsPublic = form.watch('isPublic');
  const watchedDescText = form.watch('descriptionText');

  const selectedService = services.find(s => s.id === watchedServiceId);

  // Server Action State
  const [_state, formAction, isPending] = useActionState(action, null);

  const onSubmit = (data: FormValues) => {
    const formData = new FormData();
    formData.append('name', data.name);
    formData.append('description', data.description || '');
    formData.append('title', data.title);
    formData.append('descriptionText', data.descriptionText || '');
    formData.append('defaultUrgency', data.defaultUrgency);
    if (data.defaultPriority) formData.append('defaultPriority', data.defaultPriority);
    if (data.defaultServiceId) formData.append('defaultServiceId', data.defaultServiceId);
    if (data.isPublic) formData.append('isPublic', 'on');

    React.startTransition(() => {
      formAction(formData);
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Main Form Fields (Left 7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* Card 1: Template Metadata */}
            <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs overflow-hidden">
              {/* Top Accent Gradient Bar */}
              <div className="h-1 w-full bg-gradient-to-r from-rose-500 via-orange-400 to-amber-400" />

              <div className="p-5 sm:p-6 space-y-5">
                <div className="flex items-center gap-2.5 pb-2 border-b border-border/70">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                    <Layers className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Template Identity</h3>
                    <p className="text-[11px] text-muted-foreground">
                      Name and organizational scope for this incident template.
                    </p>
                  </div>
                </div>

                {/* Template Name */}
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                        <span>
                          Template Name <span className="text-rose-500">*</span>
                        </span>
                        <span className="text-[11px] font-normal text-muted-foreground">
                          e.g. Database Outage
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. Database Connection Pool Exhaustion"
                          className="h-9.5 bg-background border-border/80 text-sm focus-visible:ring-primary/20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* Internal Description */}
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                        <span>Internal Description</span>
                        <span className="text-[11px] font-normal text-muted-foreground">
                          Optional guidance
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="When to use this template (e.g. Use when Redis/Postgres latency breaches SLA)"
                          className="h-9.5 bg-background border-border/80 text-sm focus-visible:ring-primary/20"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />

                {/* Public vs Private Selection */}
                <FormField
                  control={form.control}
                  name="isPublic"
                  render={({ field }) => (
                    <FormItem className="space-y-2">
                      <FormLabel className="text-xs font-semibold text-foreground">
                        Visibility & Sharing
                      </FormLabel>
                      <FormControl>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <button
                            type="button"
                            onClick={() => field.onChange(true)}
                            className={cn(
                              'flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer',
                              field.value
                                ? 'border-primary/50 bg-primary/8 text-foreground ring-1 ring-primary/30 shadow-2xs'
                                : 'border-border/80 bg-background/50 hover:bg-muted/40 text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 mt-0.5">
                              <Globe className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">
                                  Public SOP
                                </span>
                                {field.value && (
                                  <Badge
                                    variant="neutral"
                                    size="xs"
                                    className="text-[9px] bg-primary/10 text-primary border-primary/30 font-bold"
                                  >
                                    Selected
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                Available to all engineers across the organization.
                              </p>
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => field.onChange(false)}
                            className={cn(
                              'flex items-start gap-3 p-3 rounded-xl border text-left transition-all cursor-pointer',
                              !field.value
                                ? 'border-primary/50 bg-primary/8 text-foreground ring-1 ring-primary/30 shadow-2xs'
                                : 'border-border/80 bg-background/50 hover:bg-muted/40 text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted border border-border/80 text-muted-foreground mt-0.5">
                              <Lock className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-foreground">
                                  Private SOP
                                </span>
                                {!field.value && (
                                  <Badge
                                    variant="neutral"
                                    size="xs"
                                    className="text-[9px] bg-primary/10 text-primary border-primary/30 font-bold"
                                  >
                                    Selected
                                  </Badge>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                Only visible to you in your personal triage picker.
                              </p>
                            </div>
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* Card 2: Pre-Configured Incident Defaults */}
            <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs p-5 sm:p-6 space-y-5">
              <div className="flex items-center gap-2.5 pb-2 border-b border-border/70">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 text-primary">
                  <FileText className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Default Incident Values</h3>
                  <p className="text-[11px] text-muted-foreground">
                    Pre-fills title, severity, and investigation guide when declaring an incident.
                  </p>
                </div>
              </div>

              {/* Default Incident Title */}
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>
                        Default Incident Title <span className="text-rose-500">*</span>
                      </span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        Appears on dashboards & alerts
                      </span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. [P1] Primary Database Pool Exhaustion Detected"
                        className="h-9.5 bg-background border-border/80 text-sm font-medium focus-visible:ring-primary/20"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Service Selection Combobox */}
              <FormField
                control={form.control}
                name="defaultServiceId"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Affected Service</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        Optional pre-link
                      </span>
                    </FormLabel>
                    <Popover open={serviceOpen} onOpenChange={setServiceOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              'w-full justify-between h-9.5 bg-background border-border/80 text-sm font-normal cursor-pointer',
                              !field.value && 'text-muted-foreground'
                            )}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <Server className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              {field.value
                                ? services.find(s => s.id === field.value)?.name
                                : 'Select affected service (optional)...'}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder="Search services..." className="h-9 text-xs" />
                          <CommandList>
                            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                              No service found.
                            </CommandEmpty>
                            <CommandGroup>
                              <CommandItem
                                value="none"
                                onSelect={() => {
                                  form.setValue('defaultServiceId', '');
                                  setServiceOpen(false);
                                }}
                                className="cursor-pointer text-xs"
                              >
                                <Check
                                  className={cn(
                                    'mr-2 h-3.5 w-3.5 text-primary',
                                    !field.value ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                None (Responder selects during declaration)
                              </CommandItem>
                              {services.map(service => (
                                <CommandItem
                                  value={service.name}
                                  key={service.id}
                                  onSelect={() => {
                                    form.setValue('defaultServiceId', service.id);
                                    setServiceOpen(false);
                                  }}
                                  className="cursor-pointer text-xs flex items-center justify-between"
                                >
                                  <span className="flex items-center gap-2 truncate">
                                    <Check
                                      className={cn(
                                        'h-3.5 w-3.5 text-primary shrink-0',
                                        service.id === field.value ? 'opacity-100' : 'opacity-0'
                                      )}
                                    />
                                    {service.name}
                                  </span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Default Urgency (3 Cards matching CreateIncidentModal) */}
              <FormField
                control={form.control}
                name="defaultUrgency"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Default Urgency (Paging Speed)</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        On-call notification behavior
                      </span>
                    </FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {URGENCY_OPTIONS.map(opt => {
                          const isSelected = field.value === opt.value;
                          const Icon = opt.icon;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => field.onChange(opt.value)}
                              className={cn(
                                'flex flex-col items-start p-3 rounded-xl border text-left transition-all cursor-pointer',
                                isSelected ? opt.selectedClass : opt.idleClass
                              )}
                              title={opt.desc}
                            >
                              <div className="flex items-center gap-2 w-full">
                                <Icon className={cn('h-4 w-4 shrink-0', opt.iconClass)} />
                                <span className="text-xs font-bold truncate">{opt.label}</span>
                              </div>
                              <span className="text-[10px] font-medium opacity-80 mt-1">
                                {opt.sublabel}
                              </span>
                              <p className="text-[10px] text-muted-foreground mt-1.5 line-clamp-2 leading-snug">
                                {opt.desc}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Default Priority (P1-P5 Chips) */}
              <FormField
                control={form.control}
                name="defaultPriority"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-xs font-semibold text-foreground flex items-center justify-between">
                      <span>Default Priority (Severity)</span>
                      <span className="text-[11px] font-normal text-muted-foreground">
                        Click again to clear
                      </span>
                    </FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap items-center gap-2">
                        {PRIORITY_OPTIONS.map(opt => {
                          const isSelected = field.value === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => field.onChange(isSelected ? '' : opt.value)}
                              className={cn(
                                'px-3.5 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer shadow-2xs',
                                isSelected
                                  ? opt.activeClass
                                  : 'bg-background/80 border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                              )}
                              title={opt.title}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                        {field.value && (
                          <button
                            type="button"
                            onClick={() => field.onChange('')}
                            className="text-[11px] text-muted-foreground hover:text-foreground underline pl-1 cursor-pointer"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              {/* Default Description with Write / Preview Tabs */}
              <FormField
                control={form.control}
                name="descriptionText"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <div className="flex items-center justify-between">
                      <FormLabel className="text-xs font-semibold text-foreground">
                        Default Incident Description & Runbook Checklist
                      </FormLabel>
                      {/* Write / Preview Tab switcher */}
                      <div className="flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 text-xs">
                        <button
                          type="button"
                          onClick={() => setDescTab('write')}
                          className={cn(
                            'flex items-center gap-1 px-2.5 py-0.5 rounded-md font-medium transition-all cursor-pointer',
                            descTab === 'write'
                              ? 'bg-background text-foreground shadow-2xs font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <PenLine className="h-3 w-3" />
                          Write
                        </button>
                        <button
                          type="button"
                          onClick={() => setDescTab('preview')}
                          className={cn(
                            'flex items-center gap-1 px-2.5 py-0.5 rounded-md font-medium transition-all cursor-pointer',
                            descTab === 'preview'
                              ? 'bg-background text-foreground shadow-2xs font-semibold'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <Eye className="h-3 w-3" />
                          Preview
                        </button>
                      </div>
                    </div>

                    <FormControl>
                      {descTab === 'write' ? (
                        <div className="space-y-1.5">
                          <Textarea
                            placeholder="Provide triage instructions, links to dashboards, or step-by-step investigation checklists...&#10;&#10;### Immediate Checklist&#10;- [ ] Verify database connection metrics&#10;- [ ] Check error rate spike on Datadog"
                            className="min-h-[140px] bg-background border-border/80 text-xs font-mono focus-visible:ring-primary/20 leading-relaxed"
                            {...field}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Supports Markdown: <code>**bold**</code>, <code>`code`</code>,{' '}
                            <code>### Subheadings</code>, and bullet lists.
                          </p>
                        </div>
                      ) : (
                        <div className="min-h-[140px] rounded-xl border border-border/80 bg-muted/20 p-3.5">
                          {renderMarkdown(field.value || '')}
                        </div>
                      )}
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            </div>

            {/* Bottom Actions Card */}
            <div className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
              <Link href="/incidents/templates">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Cancel
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={isPending}
                className="font-semibold text-xs h-9 px-5 shadow-xs cursor-pointer"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                    Creating Template...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Save Incident Template
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Sticky Sidebar Preview (Right 5 Cols) */}
          <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-6">
            {/* Live Template Picker Chip Preview */}
            <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs p-5 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Modal Picker Preview
                  </h4>
                </div>
                <Badge
                  variant="neutral"
                  size="xs"
                  className="text-[9px] font-mono uppercase bg-muted"
                >
                  Live Preview
                </Badge>
              </div>

              <p className="text-[11px] text-muted-foreground leading-snug">
                How responders will see this template chip inside the{' '}
                <strong>Declare Incident</strong> modal:
              </p>

              {/* Simulated Pill in the Modal */}
              <div className="p-3 rounded-xl border border-border/70 bg-muted/30 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-2xs">
                  <Check className="h-3 w-3 text-primary shrink-0" />
                  <span>{watchedName || 'Template Name'}</span>
                  {selectedService && (
                    <span className="text-[10px] font-medium opacity-85 bg-background/80 px-1.5 py-0.5 rounded border border-primary/20">
                      {selectedService.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Simulated Incident Card Preview */}
            <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs p-5 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Incident Card Preview
                  </h4>
                </div>
                <Badge variant="neutral" size="xs" className="text-[9px] font-mono uppercase">
                  #INC-PREVIEW
                </Badge>
              </div>

              <p className="text-[11px] text-muted-foreground leading-snug">
                Appearance of incidents spawned from this template:
              </p>

              {/* Mini Incident Card */}
              <div
                className={cn(
                  'rounded-xl border border-border/80 bg-background/80 p-3.5 space-y-2.5 shadow-2xs border-l-4',
                  watchedUrgency === 'HIGH'
                    ? 'border-l-rose-500'
                    : watchedUrgency === 'MEDIUM'
                      ? 'border-l-amber-500'
                      : 'border-l-emerald-500'
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {watchedPriority && (
                    <Badge
                      variant="neutral"
                      size="xs"
                      className={cn(
                        'text-[9px] font-bold font-mono',
                        watchedPriority === 'P1'
                          ? 'bg-rose-500/15 text-rose-700 border-rose-500/30 dark:text-rose-300'
                          : watchedPriority === 'P2'
                            ? 'bg-orange-500/15 text-orange-700 border-orange-500/30 dark:text-orange-300'
                            : 'bg-muted text-foreground'
                      )}
                    >
                      {watchedPriority}
                    </Badge>
                  )}
                  <Badge
                    variant="neutral"
                    size="xs"
                    className={cn(
                      'text-[9px] font-semibold uppercase font-mono',
                      watchedUrgency === 'HIGH'
                        ? 'text-rose-700 bg-rose-500/10 border-rose-500/30 dark:text-rose-300'
                        : watchedUrgency === 'MEDIUM'
                          ? 'text-amber-700 bg-amber-500/10 border-amber-500/30 dark:text-amber-300'
                          : 'text-emerald-700 bg-emerald-500/10 border-emerald-500/30 dark:text-emerald-300'
                    )}
                  >
                    {watchedUrgency}
                  </Badge>
                  {watchedIsPublic ? (
                    <Badge
                      variant="neutral"
                      size="xs"
                      className="text-[9px] gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                    >
                      <Globe className="h-2.5 w-2.5" /> Public
                    </Badge>
                  ) : (
                    <Badge
                      variant="neutral"
                      size="xs"
                      className="text-[9px] gap-1 bg-muted text-muted-foreground"
                    >
                      <Lock className="h-2.5 w-2.5" /> Private
                    </Badge>
                  )}
                </div>

                <div>
                  <h5 className="text-xs font-bold text-foreground line-clamp-1">
                    {watchedTitle || 'Incident Title will appear here...'}
                  </h5>
                  {watchedDescText ? (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                      {watchedDescText}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/50">
                  {selectedService ? (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <Server className="h-2.5 w-2.5 text-muted-foreground" />
                      {selectedService.name}
                    </span>
                  ) : (
                    <span className="italic">Service selected during triage</span>
                  )}
                </div>
              </div>
            </div>

            {/* Best Practices Advice Card */}
            <div className="rounded-2xl border border-border/80 bg-muted/20 p-4 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-foreground">
                <Lightbulb className="h-4 w-4 text-amber-500" />
                <span>SOP Best Practices</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-muted-foreground leading-relaxed list-disc list-inside">
                <li>
                  Use explicit prefix tags in titles like <code>[P1] Service Name - Issue</code>
                </li>
                <li>Embed direct links to observability dashboards and alert channels</li>
                <li>
                  Set <strong>High Urgency</strong> only for active customer-facing crises to avoid
                  paging fatigue
                </li>
              </ul>
            </div>
          </div>
        </div>
      </form>
    </Form>
  );
}
