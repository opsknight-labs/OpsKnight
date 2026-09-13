'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutTemplate } from 'lucide-react';
import MobileButton from '@/components/mobile/MobileButton';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';
import { toUserFacingError } from '@/lib/user-facing-error';
import {
  INCIDENT_PRIORITIES,
  INCIDENT_PRIORITY_DEFINITIONS,
  type IncidentPriority,
} from '@/lib/incidents/priority';

type Service = {
  id: string;
  name: string;
  defaultIncidentVisibility?: 'PUBLIC' | 'PRIVATE';
};

type User = { id: string; name: string | null; email: string };

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

type CreateIncidentResult = {
  id: string;
  outcome: 'CREATED' | 'MERGED' | 'REOPENED';
} | null;

const FIELD_LABEL = 'text-xs font-semibold text-foreground';
const CONTROL =
  'min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20';

export default function MobileCreateIncidentClient({
  services,
  users,
  templates,
  createAction,
}: {
  services: Service[];
  users: User[];
  templates: Template[];
  createAction: (formData: FormData) => Promise<CreateIncidentResult>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedServiceId = searchParams.get('serviceId') || '';
  const requestedTemplateId = searchParams.get('templateId') || '';
  const initialTemplate = templates.find(template => template.id === requestedTemplateId);
  const initialTemplateServiceId = initialTemplate?.defaultService?.id || '';
  const initialServiceId = initialTemplate
    ? services.some(service => service.id === initialTemplateServiceId)
      ? initialTemplateServiceId
      : ''
    : services.some(service => service.id === requestedServiceId)
      ? requestedServiceId
      : '';
  const initialService = services.find(service => service.id === initialServiceId);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(initialTemplate?.title || '');
  const [description, setDescription] = useState(initialTemplate?.descriptionText || '');
  const [urgency, setUrgency] = useState<'HIGH' | 'MEDIUM' | 'LOW'>(
    initialTemplate?.defaultUrgency || 'HIGH'
  );
  const [priority, setPriority] = useState(initialTemplate?.defaultPriority || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate?.id || '');
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId);
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    initialService?.defaultIncidentVisibility || 'PUBLIC'
  );
  const [userModifiedVisibility, setUserModifiedVisibility] = useState(false);

  const selectedService = services.find(service => service.id === selectedServiceId);
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId);
  const selectedPriorityDefinition = useMemo(() => {
    if (!priority || !INCIDENT_PRIORITIES.includes(priority as IncidentPriority)) return null;
    return INCIDENT_PRIORITY_DEFINITIONS[priority as IncidentPriority];
  }, [priority]);

  const handleServiceChange = (serviceId: string) => {
    setSelectedServiceId(serviceId);
    const service = services.find(item => item.id === serviceId);
    if (!userModifiedVisibility && service?.defaultIncidentVisibility) {
      setVisibility(service.defaultIncidentVisibility);
    }
  };

  const applyTemplate = (template: Template) => {
    setSelectedTemplateId(template.id);
    setTitle(template.title);
    setDescription(template.descriptionText || '');
    setUrgency(template.defaultUrgency);
    setPriority(template.defaultPriority || '');

    const templateServiceId = template.defaultService?.id || '';
    const allowedServiceId = services.some(service => service.id === templateServiceId)
      ? templateServiceId
      : '';
    setSelectedServiceId(allowedServiceId);
    const service = services.find(item => item.id === allowedServiceId);
    setUserModifiedVisibility(false);
    setVisibility(service?.defaultIncidentVisibility || 'PUBLIC');
  };

  const handleTemplateChange = (templateId: string) => {
    if (!templateId) {
      // Clearing the selector must not destroy responder-entered content.
      setSelectedTemplateId('');
      return;
    }
    const template = templates.find(item => item.id === templateId);
    if (template) applyTemplate(template);
  };

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError('');

    try {
      const result = await createAction(formData);
      if (result?.id) {
        const message =
          result.outcome === 'MERGED'
            ? 'Report merged into the existing incident'
            : result.outcome === 'REOPENED'
              ? 'Incident reopened from your report'
              : 'Incident created successfully';
        toast.success(message);
        router.push(`/m/incidents/${result.id}`);
      } else {
        toast.error('Incident creation did not return a result');
        setLoading(false);
      }
    } catch (err: unknown) {
      const errorInfo =
        err && typeof err === 'object' ? (err as { message?: string; digest?: string }) : {};
      if (errorInfo.message === 'NEXT_REDIRECT' || errorInfo.digest?.startsWith('NEXT_REDIRECT')) {
        throw err;
      }
      const userFacing = toUserFacingError(err, 'Failed to create incident. Please try again.');
      setError(
        userFacing.description ? `${userFacing.title}. ${userFacing.description}` : userFacing.title
      );
      setLoading(false);
    }
  }

  const truncate = (str: string | null, len: number) => {
    if (!str) return '';
    return str.length > len ? `${str.substring(0, len)}...` : str;
  };

  return (
    <form action={handleSubmit} className="space-y-5">
      {templates.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <LayoutTemplate className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <label
                htmlFor="incident-template"
                className="block text-sm font-semibold text-foreground"
              >
                Incident template
              </label>
              <p className="text-[11px] text-muted-foreground">
                Optional · pre-fills the incident form
              </p>
            </div>
          </div>

          <div className="relative">
            <select
              id="incident-template"
              value={selectedTemplateId}
              onChange={event => handleTemplateChange(event.target.value)}
              className={cn(CONTROL, 'appearance-none pr-10')}
            >
              <option value="">Start without a template</option>
              {templates.map(template => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>

          {selectedTemplate && (
            <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedTemplate.name}</span>
              {selectedTemplate.description ? ` · ${selectedTemplate.description}` : ''}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <span>{selectedTemplate.defaultUrgency} urgency</span>
                {selectedTemplate.defaultPriority && (
                  <span>{selectedTemplate.defaultPriority} priority</span>
                )}
                {selectedTemplate.defaultService && (
                  <span>{selectedTemplate.defaultService.name}</span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="incident-title" className={FIELD_LABEL}>
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="incident-title"
            name="title"
            required
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder="e.g. API Gateway High Latency"
            className={CONTROL}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="incident-description" className={FIELD_LABEL}>
            Description
          </label>
          <textarea
            id="incident-description"
            name="description"
            rows={4}
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="What's happening? Add context..."
            className={cn(CONTROL, 'min-h-28 resize-y py-3')}
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="incident-service" className={FIELD_LABEL}>
            Service <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <select
              id="incident-service"
              name="serviceId"
              required
              value={selectedServiceId}
              onChange={event => handleServiceChange(event.target.value)}
              className={cn(CONTROL, 'appearance-none pr-10')}
            >
              <option value="" disabled>
                Select a service
              </option>
              {services.map(service => (
                <option key={service.id} value={service.id}>
                  {truncate(service.name, 40)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <span className={FIELD_LABEL}>Urgency</span>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Controls responder notification behavior.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <UrgencyRadio
              name="urgency"
              value="HIGH"
              label="High"
              checked={urgency === 'HIGH'}
              onChange={() => setUrgency('HIGH')}
            />
            <UrgencyRadio
              name="urgency"
              value="MEDIUM"
              label="Medium"
              checked={urgency === 'MEDIUM'}
              onChange={() => setUrgency('MEDIUM')}
            />
            <UrgencyRadio
              name="urgency"
              value="LOW"
              label="Low"
              checked={urgency === 'LOW'}
              onChange={() => setUrgency('LOW')}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div>
            <label htmlFor="incident-priority" className={FIELD_LABEL}>
              Priority
            </label>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Optional business-impact classification, separate from paging urgency.
            </p>
          </div>
          <div className="relative">
            <select
              id="incident-priority"
              name="priority"
              value={priority}
              onChange={event => setPriority(event.target.value)}
              className={cn(CONTROL, 'appearance-none pr-10')}
            >
              <option value="">Unassigned</option>
              {Object.entries(INCIDENT_PRIORITY_DEFINITIONS).map(([priorityKey, definition]) => (
                <option key={priorityKey} value={priorityKey}>
                  {priorityKey} · {definition.label}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          {selectedPriorityDefinition && (
            <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              {selectedPriorityDefinition.description}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <span className={FIELD_LABEL}>Visibility</span>
          <div className="grid grid-cols-2 gap-2">
            <VisibilityRadio
              value="PUBLIC"
              label="Public"
              checked={visibility === 'PUBLIC'}
              isDefault={selectedService?.defaultIncidentVisibility === 'PUBLIC'}
              onChange={() => {
                setUserModifiedVisibility(true);
                setVisibility('PUBLIC');
              }}
            />
            <VisibilityRadio
              value="PRIVATE"
              label="Private"
              checked={visibility === 'PRIVATE'}
              isDefault={selectedService?.defaultIncidentVisibility === 'PRIVATE'}
              onChange={() => {
                setUserModifiedVisibility(true);
                setVisibility('PRIVATE');
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="incident-assignee" className={FIELD_LABEL}>
            Assignee (optional)
          </label>
          <div className="relative">
            <select
              id="incident-assignee"
              name="assigneeId"
              className={cn(CONTROL, 'appearance-none pr-10')}
            >
              <option value="">Unassigned</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>
                  {truncate(user.name || user.email, 40)}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      {error && (
        <div
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
        <MobileButton type="button" variant="secondary" fullWidth onClick={() => router.back()}>
          Cancel
        </MobileButton>
        <MobileButton type="submit" fullWidth loading={loading}>
          {loading ? 'Submitting...' : 'Create incident'}
        </MobileButton>
      </div>
    </form>
  );
}

function UrgencyRadio({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: 'HIGH' | 'MEDIUM' | 'LOW';
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-xs font-semibold transition-colors',
        checked
          ? value === 'HIGH'
            ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            : value === 'MEDIUM'
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
              : 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300'
          : 'border-border bg-card text-muted-foreground'
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      {label}
    </label>
  );
}

function VisibilityRadio({
  value,
  label,
  checked,
  isDefault,
  onChange,
}: {
  value: 'PUBLIC' | 'PRIVATE';
  label: string;
  checked: boolean;
  isDefault: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors',
        checked
          ? 'border-primary/50 bg-primary/10 text-foreground'
          : 'border-border bg-card text-muted-foreground'
      )}
    >
      <input
        type="radio"
        name="visibility"
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span>{label}</span>
      {isDefault && <span className="text-[10px] font-normal text-muted-foreground">default</span>}
    </label>
  );
}
