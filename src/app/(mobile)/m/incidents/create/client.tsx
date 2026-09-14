'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, LayoutTemplate, WifiOff } from 'lucide-react';
import MobileButton from '@/components/mobile/MobileButton';
import { cn } from '@/lib/utils';
import { notify as toast } from '@/lib/toast';
import { toUserFacingError } from '@/lib/user-facing-error';
import { errorFromResponse } from '@/lib/client-error';
import {
  INCIDENT_PRIORITIES,
  getIncidentPriorityDefinition,
  normalizeIncidentPriority,
  type IncidentPriority,
} from '@/lib/incidents/priority';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { removeMobileCacheEntry } from '@/lib/mobile-cache-status';
import { ClientTimeoutError, fetchWithTimeout } from '@/lib/client-timeout';
import { appRoutes } from '@/lib/app-routes';

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
  replayed?: boolean;
};
type Draft = {
  title: string;
  description: string;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: string;
  selectedServiceId: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  assigneeId: string;
};

const FIELD_LABEL = 'text-xs font-semibold text-foreground';
const CONTROL =
  'min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/20';
const DRAFT_KEY = 'incident-create-draft';
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function requestKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `create_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export default function MobileCreateIncidentClient({
  services,
  users,
  templates,
}: {
  services: Service[];
  users: User[];
  templates: Template[];
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
  const [offline, setOffline] = useState(false);
  const [draftReady, setDraftReady] = useState(Boolean(initialTemplate || requestedServiceId));
  const [title, setTitle] = useState(initialTemplate?.title || '');
  const [description, setDescription] = useState(initialTemplate?.descriptionText || '');
  const [urgency, setUrgency] = useState<'HIGH' | 'MEDIUM' | 'LOW'>(initialTemplate?.defaultUrgency || 'HIGH');
  const [priority, setPriority] = useState(initialTemplate?.defaultPriority || '');
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate?.id || '');
  const [selectedServiceId, setSelectedServiceId] = useState(initialServiceId);
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(initialService?.defaultIncidentVisibility || 'PUBLIC');
  const [userModifiedVisibility, setUserModifiedVisibility] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const submissionRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const selectedService = services.find(service => service.id === selectedServiceId);
  const selectedTemplate = templates.find(template => template.id === selectedTemplateId);
  const normalizedPriority = normalizeIncidentPriority(priority);
  const selectedPriorityDefinition = normalizedPriority
    ? getIncidentPriorityDefinition(normalizedPriority)
    : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    if (draftReady || initialTemplate || requestedServiceId) return;
    let cancelled = false;
    void readCache<Draft>(DRAFT_KEY, DRAFT_MAX_AGE_MS).then(draft => {
      if (cancelled || !draft) {
        if (!cancelled) setDraftReady(true);
        return;
      }
      setTitle(draft.title);
      setDescription(draft.description);
      setUrgency(draft.urgency);
      setPriority(draft.priority);
      setSelectedServiceId(
        services.some(service => service.id === draft.selectedServiceId) ? draft.selectedServiceId : ''
      );
      setVisibility(draft.visibility);
      setUserModifiedVisibility(true);
      setAssigneeId(users.some(user => user.id === draft.assigneeId) ? draft.assigneeId : '');
      setDraftReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [draftReady, initialTemplate, requestedServiceId, services, users]);

  const draft = useMemo<Draft>(
    () => ({ title, description, urgency, priority, selectedServiceId, visibility, assigneeId }),
    [assigneeId, description, priority, selectedServiceId, title, urgency, visibility]
  );

  useEffect(() => {
    if (!draftReady) return;
    const timer = window.setTimeout(() => {
      if (
        draft.title ||
        draft.description ||
        draft.selectedServiceId ||
        draft.priority ||
        draft.assigneeId
      ) {
        void writeCache(DRAFT_KEY, draft, { maxAgeMs: DRAFT_MAX_AGE_MS });
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, draftReady]);

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
    setAssigneeId('');
    const templateServiceId = template.defaultService?.id || '';
    const allowedServiceId = services.some(service => service.id === templateServiceId) ? templateServiceId : '';
    setSelectedServiceId(allowedServiceId);
    const service = services.find(item => item.id === allowedServiceId);
    setUserModifiedVisibility(false);
    setVisibility(service?.defaultIncidentVisibility || 'PUBLIC');
  };

  const handleTemplateChange = (templateId: string) => {
    if (!templateId) {
      // Clearing a template never destroys responder-entered values.
      setSelectedTemplateId('');
      return;
    }
    const template = templates.find(item => item.id === templateId);
    if (template) applyTemplate(template);
  };

  const submit = async () => {
    setError('');
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!selectedServiceId) {
      setError('Select a service before creating the incident.');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Offline. Your encrypted draft is saved on this device; incident creation is not queued until you reconnect.');
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      serviceId: selectedServiceId,
      urgency,
      priority: priority || null,
      assigneeId: assigneeId || null,
      visibility,
    };
    const fingerprint = JSON.stringify(payload);
    if (!submissionRef.current || submissionRef.current.fingerprint !== fingerprint) {
      submissionRef.current = { fingerprint, idempotencyKey: requestKey() };
    }

    setLoading(true);
    try {
      const response = await fetchWithTimeout(
        '/api/incidents/create',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': submissionRef.current.idempotencyKey,
          },
          credentials: 'include',
          cache: 'no-store',
          body: JSON.stringify(payload),
        },
        12_000
      );
      if (!response.ok) throw await errorFromResponse(response, 'Failed to create incident.');
      const result = (await response.json()) as CreateIncidentResult;
      if (!result.id) throw new Error('Incident creation did not return an incident identifier.');
      removeMobileCacheEntry(DRAFT_KEY);
      const message =
        result.outcome === 'MERGED'
          ? 'Report merged into the existing incident'
          : result.outcome === 'REOPENED'
            ? 'Incident reopened from your report'
            : result.replayed
              ? 'Incident creation confirmed after retry'
              : 'Incident created successfully';
      toast.success(message);
      router.replace(appRoutes.incident('mobile', result.id));
      router.refresh();
    } catch (submitError) {
      if (submitError instanceof ClientTimeoutError) {
        setError('The request timed out before confirmation. Retry safely: OpsKnight will reuse the same request ID and will not create a duplicate.');
      } else if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('Connection was lost. Your encrypted draft is saved; reconnect and press Create incident again.');
      } else {
        const userFacing = toUserFacingError(submitError, 'Failed to create incident. Please try again.');
        setError(userFacing.description ? `${userFacing.title}. ${userFacing.description}` : userFacing.title);
      }
    } finally {
      setLoading(false);
    }
  };

  const truncate = (value: string | null, length: number) => {
    if (!value) return '';
    return value.length > length ? `${value.substring(0, length)}...` : value;
  };

  return (
    <form
      className="space-y-5"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      {offline ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Offline — editing is safe and the draft is saved, but incident creation requires a connection.</span>
        </div>
      ) : null}

      {templates.length > 0 ? (
        <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><LayoutTemplate className="h-4 w-4" aria-hidden="true" /></span>
            <div className="min-w-0">
              <label htmlFor="incident-template" className="block text-sm font-semibold text-foreground">Incident template</label>
              <p className="text-[11px] text-muted-foreground">Optional · pre-fills the incident form</p>
            </div>
          </div>
          <div className="relative">
            <select id="incident-template" value={selectedTemplateId} onChange={event => handleTemplateChange(event.target.value)} className={cn(CONTROL, 'appearance-none pr-10')}>
              <option value="">Start without a template</option>
              {templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
          {selectedTemplate ? (
            <div className="mt-2 rounded-xl bg-muted/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedTemplate.name}</span>
              {selectedTemplate.description ? ` · ${selectedTemplate.description}` : ''}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                <span>{selectedTemplate.defaultUrgency} urgency</span>
                {selectedTemplate.defaultPriority ? <span>{selectedTemplate.defaultPriority} priority</span> : null}
                {selectedTemplate.defaultService ? <span>{selectedTemplate.defaultService.name}</span> : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="incident-title" className={FIELD_LABEL}>Title <span className="text-destructive">*</span></label>
          <input id="incident-title" required value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. API Gateway High Latency" className={CONTROL} maxLength={500} />
        </div>
        <div className="space-y-2">
          <label htmlFor="incident-description" className={FIELD_LABEL}>Description</label>
          <textarea id="incident-description" rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="What's happening? Add context..." className={cn(CONTROL, 'min-h-28 resize-y py-3')} maxLength={10_000} />
        </div>
        <div className="space-y-2">
          <label htmlFor="incident-service" className={FIELD_LABEL}>Service <span className="text-destructive">*</span></label>
          <div className="relative">
            <select id="incident-service" required value={selectedServiceId} onChange={event => handleServiceChange(event.target.value)} className={cn(CONTROL, 'appearance-none pr-10')}>
              <option value="" disabled>Select a service</option>
              {services.map(service => <option key={service.id} value={service.id}>{truncate(service.name, 40)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className={FIELD_LABEL}>Urgency</legend>
          <p className="text-[11px] text-muted-foreground">Controls responder notification behavior.</p>
          <div className="grid grid-cols-3 gap-2">
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map(value => (
              <UrgencyRadio key={value} value={value} label={value.charAt(0) + value.slice(1).toLowerCase()} checked={urgency === value} onChange={() => setUrgency(value)} />
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="incident-priority" className={FIELD_LABEL}>Priority</label>
          <p className="text-[11px] text-muted-foreground">Optional business-impact classification, separate from paging urgency.</p>
          <div className="relative">
            <select id="incident-priority" value={priority} onChange={event => setPriority(event.target.value)} className={cn(CONTROL, 'appearance-none pr-10')}>
              <option value="">Unassigned</option>
              {INCIDENT_PRIORITIES.map(priorityKey => {
                const definition = getIncidentPriorityDefinition(priorityKey);
                return <option key={priorityKey} value={priorityKey}>{priorityKey} · {definition.label}</option>;
              })}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
          {selectedPriorityDefinition ? <p className="rounded-lg bg-muted/50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">{selectedPriorityDefinition.description}</p> : null}
        </div>

        <fieldset className="space-y-2">
          <legend className={FIELD_LABEL}>Visibility</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['PUBLIC', 'PRIVATE'] as const).map(value => (
              <VisibilityRadio
                key={value}
                value={value}
                label={value === 'PUBLIC' ? 'Public' : 'Private'}
                checked={visibility === value}
                isDefault={selectedService?.defaultIncidentVisibility === value}
                onChange={() => {
                  setUserModifiedVisibility(true);
                  setVisibility(value);
                }}
              />
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <label htmlFor="incident-assignee" className={FIELD_LABEL}>Assignee (optional)</label>
          <div className="relative">
            <select id="incident-assignee" value={assigneeId} onChange={event => setAssigneeId(event.target.value)} className={cn(CONTROL, 'appearance-none pr-10')}>
              <option value="">Unassigned</option>
              {users.map(user => <option key={user.id} value={user.id}>{truncate(user.name || user.email, 40)}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive" role="alert">{error}</div> : null}

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
        <MobileButton type="button" variant="secondary" fullWidth onClick={() => router.back()}>Cancel</MobileButton>
        <MobileButton type="submit" fullWidth loading={loading} disabled={offline || !draftReady}>
          {loading ? 'Submitting…' : 'Create incident'}
        </MobileButton>
      </div>
    </form>
  );
}

function UrgencyRadio({ value, label, checked, onChange }: { value: 'HIGH' | 'MEDIUM' | 'LOW'; label: string; checked: boolean; onChange: () => void }) {
  const tone =
    value === 'HIGH'
      ? checked ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300' : ''
      : value === 'MEDIUM'
        ? checked ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300' : ''
        : checked ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : '';
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-2 text-xs font-semibold transition-colors', checked ? tone : 'border-input bg-background text-muted-foreground hover:bg-accent')}>
      <input type="radio" name="urgency" value={value} checked={checked} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

function VisibilityRadio({ value, label, checked, isDefault, onChange }: { value: 'PUBLIC' | 'PRIVATE'; label: string; checked: boolean; isDefault: boolean; onChange: () => void }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-semibold transition-colors', checked ? 'border-primary/50 bg-primary/10 text-primary' : 'border-input bg-background text-muted-foreground hover:bg-accent')}>
      <input type="radio" name="visibility" value={value} checked={checked} onChange={onChange} className="sr-only" />
      <span>{label}</span>{isDefault ? <span className="text-[9px] font-medium opacity-70">default</span> : null}
    </label>
  );
}
