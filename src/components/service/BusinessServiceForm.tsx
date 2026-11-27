/* eslint-disable security/detect-object-injection -- keys are our own field ids and Zod issue paths, never free-form input */
'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Switch } from '@/components/ui/shadcn/switch';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import { cn } from '@/lib/utils';
import { toneClasses } from '@/components/patterns/status-tone';
import { linksFromLines } from '@/lib/business-services/links';
import { attributesFromLines } from '@/lib/business-services/attributes';
import { moneyToCents } from '@/lib/business-services/impact-cost';
import { ImpactPreviewNote, TeamBulkAdd } from './BusinessServiceFormExtras';
import {
  createBusinessServiceAction,
  deleteBusinessServiceAction,
  updateBusinessServiceAction,
} from '@/app/(app)/services/business/actions';

import { MultiPicker, type Option } from './MultiPicker';
import { LinkRowsField, TagChipsField, UnsavedChangesGuard } from './BusinessServiceFormFields';
import { LIFECYCLE_LABEL } from '@/components/business-service/HealthBadge';

export type BusinessServiceFormValue = {
  id?: string;
  name: string;
  description: string;
  /** Shown on status pages instead of the description. */
  statusPageSummary: string;
  /** One "Label | https://url" per line; edited as rows. */
  linksText: string;
  tier: string;
  ownerTeamId: string;
  memberServiceIds: string[];
  followerUserIds: string[];
  /** '' = not set. */
  criticality: '' | 'TIER_0' | 'TIER_1' | 'TIER_2' | 'TIER_3';
  /** '' = the tier default. */
  impactMinUrgency: '' | 'LOW' | 'MEDIUM' | 'HIGH';
  /** '' = the tier default; else P1..P5. */
  impactMaxPriority: string;
  /** Members that can make it degraded at most; a subset of memberServiceIds. */
  nonCriticalServiceIds: string[];
  /** Business services this one depends on. */
  dependsOnBusinessServiceIds: string[];
  teamSubscriberIds: string[];
  ownerUserId: string;
  escalationPolicyId: string;
  contactChannel: string;
  environment: string;
  lifecycle: 'ACTIVE' | 'BETA' | 'DEPRECATED' | 'RETIRED';
  /** Comma separated. */
  tagsText: string;
  /** One "key = value" per line. */
  attributesText: string;
  /** Tick to stamp "reviewed" now. */
  markReviewed: boolean;
  /** Percent, '' = no SLO. */
  sloTarget: string;
  sloWindowDays: '7' | '30' | '90';
  /** '' = worst-of (no quorum rule). */
  quorumPartialPct: string;
  quorumMajorPct: string;
  dependencyHopDepth: string;
  /** Customer impact: '' = unknown/off. Revenue is in major units, e.g. 12000.50. */
  customersTotal?: string;
  revenuePerHour?: string;
  currency?: string;
  customerReportThreshold?: string;
  customerReportWindowMinutes?: string;
  reviewIntervalDays?: string;
  /** Publish status page updates for this business service without waiting for approval. */
  autoPublishStatusUpdates?: boolean;
};

const NO_TEAM = '__none__';
const DEFAULT = '__default__';
const CRITICALITIES = [
  { value: 'TIER_0', label: 'Tier 0 · Mission critical' },
  { value: 'TIER_1', label: 'Tier 1 · Business critical' },
  { value: 'TIER_2', label: 'Tier 2 · Important' },
  { value: 'TIER_3', label: 'Tier 3 · Supporting' },
] as const;
const URGENCIES = [
  { value: 'HIGH', label: 'High urgency only' },
  { value: 'MEDIUM', label: 'Medium urgency and above' },
  { value: 'LOW', label: 'Any urgency' },
] as const;
const PRIORITIES = ['P1', 'P2', 'P3', 'P4', 'P5'];

const EMPTY: BusinessServiceFormValue = {
  name: '',
  description: '',
  statusPageSummary: '',
  linksText: '',
  tier: '',
  ownerTeamId: '',
  memberServiceIds: [],
  followerUserIds: [],
  criticality: '',
  impactMinUrgency: '',
  impactMaxPriority: '',
  nonCriticalServiceIds: [],
  dependsOnBusinessServiceIds: [],
  teamSubscriberIds: [],
  ownerUserId: '',
  escalationPolicyId: '',
  contactChannel: '',
  environment: '',
  lifecycle: 'ACTIVE',
  tagsText: '',
  attributesText: '',
  markReviewed: false,
  sloTarget: '',
  sloWindowDays: '30',
  quorumPartialPct: '',
  quorumMajorPct: '',
  dependencyHopDepth: '3',
  customersTotal: '',
  revenuePerHour: '',
  currency: 'USD',
  customerReportThreshold: '',
  customerReportWindowMinutes: '',
  reviewIntervalDays: '',
  autoPublishStatusUpdates: false,
};
const LIFECYCLES = ['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED'] as const;
const ADVANCED_IDS = ['bs-quorum-partial', 'bs-quorum-major', 'bs-hops'];
const SECTIONS = [
  ['#bs-sec-basics', 'Basics'],
  ['#bs-sec-ownership', 'Ownership and SLO'],
  ['#bs-sec-customers', 'Customer impact'],
  ['#bs-sec-impact', 'What counts as impact'],
  ['#bs-sec-people', 'Followers'],
] as const;
const pct = (text: string) => (text.trim() === '' ? null : Number(text));

type FormErrors = { errors: Record<string, string>; clear: (id: string) => void };
const FormErrorsContext = createContext<FormErrors>({ errors: {}, clear: () => undefined });

/** Server payload key to the field that shows it. */
const SERVER_FIELD_IDS: Record<string, string> = {
  name: 'bs-name',
  description: 'bs-description',
  statusPageSummary: 'bs-summary',
  links: 'bs-links',
  sloTarget: 'bs-slo',
  contactChannel: 'bs-contact',
  environment: 'bs-environment',
  tags: 'bs-tags',
  customAttributes: 'bs-attributes',
  revenuePerHourCents: 'bs-revenue',
  currency: 'bs-currency',
  customersTotal: 'bs-customers',
  customerReportThreshold: 'bs-report-threshold',
  customerReportWindowMinutes: 'bs-report-window',
  reviewIntervalDays: 'bs-review-interval',
  quorumPartialPct: 'bs-quorum-partial',
  quorumMajorPct: 'bs-quorum-major',
  dependencyHopDepth: 'bs-hops',
  memberServiceIds: 'bs-members',
};

/** Server keys with no inline message slot; their error goes in the form banner with this label. */
const BANNER_FIELD_LABELS: Record<string, string> = {
  ownerTeamId: 'Owner team',
  ownerUserId: 'Owner',
  escalationPolicyId: 'Escalation policy',
  lifecycle: 'Lifecycle',
  followerUserIds: 'Followers',
  impactMaxPriority: 'Lowest priority',
  tier: 'Criticality',
  criticality: 'Criticality',
};

/** Splits server field errors into inline ones and a banner message; always yields something to show. */
export function mapServerErrors(
  fieldErrors: Record<string, string> | undefined,
  fallback: string
): { mapped: Record<string, string>; banner: string } {
  const mapped: Record<string, string> = {};
  const banner: string[] = [];
  for (const [key, message] of Object.entries(fieldErrors ?? {})) {
    const id = SERVER_FIELD_IDS[key];
    if (id) mapped[id] = message;
    else banner.push(`${BANNER_FIELD_LABELS[key] ?? key}: ${message}`);
  }
  return { mapped, banner: banner[0] ?? fallback };
}

/** The message under a field, linked to it with `aria-describedby` via `describedBy`. */
function FieldError({ id }: { id: string }) {
  const message = useContext(FormErrorsContext).errors[id];
  return message ? (
    <p id={`${id}-error`} className={cn('text-xs font-medium', toneClasses('critical').text)}>
      {message}
    </p>
  ) : null;
}
const errorProps = (errors: Record<string, string>, id: string) =>
  errors[id] ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {};

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'decimal' | 'numeric';
}) {
  const { errors, clear } = useContext(FormErrorsContext);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={event => {
          clear(id);
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        {...errorProps(errors, id)}
      />
      <FieldError id={id} />
    </div>
  );
}

/** A single choice from a short list, '' = none. */
function PickField({
  id,
  label,
  none,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  none: string;
  value: string;
  options: Option[];
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Select
        value={value || NO_TEAM}
        onValueChange={next => onChange(next === NO_TEAM ? '' : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={none} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TEAM}>{none}</SelectItem>
          {options.map(option => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function BusinessServiceForm({
  initial,
  services,
  teams,
  users,
  escalationPolicies = [],
  businessServices = [],
  canDelete = false,
}: {
  initial?: BusinessServiceFormValue;
  services: Option[];
  teams: Option[];
  escalationPolicies?: Option[];
  users: Option[];
  /** Other business services it can depend on (never itself). */
  businessServices?: Option[];
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<BusinessServiceFormValue>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serviceOptions, setServiceOptions] = useState(services);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [baseline] = useState(() => JSON.stringify(initial ?? EMPTY));
  const dirty = !saved && JSON.stringify(value) !== baseline;
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      Boolean(initial?.quorumPartialPct || initial?.quorumMajorPct) ||
      (initial?.dependencyHopDepth ?? '3') !== '3'
  );
  const set = <K extends keyof BusinessServiceFormValue>(
    key: K,
    next: BusinessServiceFormValue[K]
  ) => setValue(current => ({ ...current, [key]: next }));

  const clear = (id: string) =>
    setErrors(current => {
      if (!(id in current)) return current;
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  const fail = (found: Record<string, string>, message?: string) => {
    setErrors(found);
    // A field inside the closed Advanced disclosure must be visible before it can take focus.
    if (ADVANCED_IDS.some(id => id in found)) setAdvancedOpen(true);
    setError(message ?? null);
    // After the summary renders, move focus to the first invalid field in page order.
    requestAnimationFrame(() => {
      const first = Object.keys(found)
        .map(id => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null)
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
        )[0];
      first?.focus();
    });
  };
  const addTeamServices = (options: Option[]) => {
    const known = new Set(serviceOptions.map(option => option.id));
    setServiceOptions(current => [...current, ...options.filter(option => !known.has(option.id))]);
    const fresh = options.filter(option => !value.memberServiceIds.includes(option.id));
    set('memberServiceIds', [...value.memberServiceIds, ...fresh.map(option => option.id)]);
    return fresh.length;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!value.name.trim()) found['bs-name'] = 'Give the business service a name.';
    const links = linksFromLines(value.linksText);
    if (!links) {
      found['bs-links'] = 'Each link needs a label and an https URL, up to 10.';
    }
    const attributes = attributesFromLines(value.attributesText);
    if (!attributes) {
      found['bs-attributes'] = 'One "key = value" per line, at most 20, keys like cost_center.';
    }
    const slo = pct(value.sloTarget);
    if (slo !== null && !(slo >= 90 && slo <= 99.999)) {
      found['bs-slo'] = 'Between 90 and 99.999 percent.';
    }
    const partial = pct(value.quorumPartialPct);
    const major = pct(value.quorumMajorPct);
    const percent = (n: number | null) => n === null || (Number.isInteger(n) && n >= 1 && n <= 100);
    if (!percent(partial)) found['bs-quorum-partial'] = 'A whole percent from 1 to 100.';
    if (!percent(major)) found['bs-quorum-major'] = 'A whole percent from 1 to 100.';
    if (partial !== null && major !== null && partial > major && !found['bs-quorum-partial']) {
      found['bs-quorum-partial'] = 'Partial cannot exceed major.';
    }
    const customers = pct(value.customersTotal ?? '');
    const revenue = (value.revenuePerHour ?? '').trim()
      ? moneyToCents(value.revenuePerHour ?? '')
      : null;
    const reportThreshold = pct(value.customerReportThreshold ?? '');
    const reportWindow = pct(value.customerReportWindowMinutes ?? '');
    const reviewDays = pct(value.reviewIntervalDays ?? '');
    const whole = (n: number | null, min: number, max: number) =>
      n === null || (Number.isInteger(n) && n >= min && n <= max);
    if ((value.revenuePerHour ?? '').trim() !== '' && revenue === null)
      found['bs-revenue'] = 'An amount like 12000.50.';
    if (!whole(customers, 0, 1_000_000_000)) found['bs-customers'] = 'A whole number.';
    if (!whole(reportThreshold, 1, 100_000))
      found['bs-report-threshold'] = 'A whole number, 1 or more.';
    if (!whole(reportWindow, 5, 1440)) found['bs-report-window'] = '5 to 1440 minutes.';
    if (!whole(reviewDays, 7, 730)) found['bs-review-interval'] = '7 to 730 days.';
    if (!/^[A-Za-z]{3}$/.test(value.currency ?? 'USD')) found['bs-currency'] = 'A 3-letter code.';
    if (!links || !attributes || Object.keys(found).length > 0) {
      const count = Object.keys(found).length;
      fail(found, `Fix ${count} ${count === 1 ? 'field' : 'fields'} before saving.`);
      return;
    }
    setError(null);
    setErrors({});
    const payload = {
      customersTotal: customers,
      revenuePerHourCents: revenue,
      currency: (value.currency ?? 'USD').toUpperCase(),
      customerReportThreshold: reportThreshold,
      customerReportWindowMinutes: reportThreshold === null ? null : reportWindow,
      reviewIntervalDays: reviewDays,
      sloTarget: slo,
      sloWindowDays: Number(value.sloWindowDays) as 7 | 30 | 90,
      ownerUserId: value.ownerUserId || null,
      escalationPolicyId: value.escalationPolicyId || null,
      contactChannel: value.contactChannel.trim() || null,
      autoPublishStatusUpdates: value.autoPublishStatusUpdates ?? false,
      environment: value.environment.trim() || null,
      lifecycle: value.lifecycle,
      tags: value.tagsText
        .split(',')
        .map(tag => tag.trim())
        .filter(Boolean),
      customAttributes: Object.keys(attributes).length ? attributes : null,
      ...(value.markReviewed ? { lastReviewedAt: new Date() } : {}),
      quorumPartialPct: partial,
      quorumMajorPct: major,
      dependencyHopDepth: Number(value.dependencyHopDepth) || 3,
      teamSubscriberIds: value.teamSubscriberIds,
      statusPageSummary: value.statusPageSummary.trim() || null,
      links,
      name: value.name.trim(),
      description: value.description.trim() || null,
      tier: value.tier || null,
      ownerTeamId: value.ownerTeamId || null,
      memberServiceIds: value.memberServiceIds,
      followerUserIds: value.followerUserIds,
      criticality: value.criticality || null,
      impactMinUrgency: value.impactMinUrgency || null,
      impactMaxPriority: value.impactMaxPriority || null,
      nonCriticalServiceIds: value.nonCriticalServiceIds.filter(serviceId =>
        value.memberServiceIds.includes(serviceId)
      ),
      dependsOnBusinessServiceIds: value.dependsOnBusinessServiceIds,
    };
    startTransition(async () => {
      const result = value.id
        ? await updateBusinessServiceAction(value.id, payload)
        : await createBusinessServiceAction(payload);
      if (!result.ok) {
        const { mapped, banner } = mapServerErrors(result.fieldErrors, result.error);
        if (Object.keys(mapped).length) fail(mapped, banner);
        else setError(banner);
        return;
      }
      notify.success(value.id ? 'Business service saved' : 'Business service created');
      setSaved(true);
      router.push(`/services/business/${result.id}`);
      router.refresh();
    });
  };

  const remove = async () => {
    if (!value.id) return;
    const result = await deleteBusinessServiceAction(value.id);
    if (!result.ok) return { error: result.error };
    notify.success('Business service deleted');
    setSaved(true);
    router.push('/services/business');
    router.refresh();
  };

  return (
    <FormErrorsContext.Provider value={{ errors, clear }}>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <a
          href="#bs-actions"
          className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
        >
          Skip to save
        </a>
        <UnsavedChangesGuard dirty={dirty && !isPending} />
        <nav
          aria-label="Form sections"
          className="sticky top-0 z-20 -mx-1 flex flex-wrap gap-x-4 gap-y-1 border-b bg-background/95 px-1 py-2 text-sm backdrop-blur supports-[backdrop-filter]:bg-background/80"
        >
          {SECTIONS.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              {label}
            </a>
          ))}
        </nav>
        {(error || Object.keys(errors).length > 0) && (
          <div
            role="alert"
            className={cn('rounded-lg border px-3 py-2 text-sm', toneClasses('critical').soft)}
          >
            <p className="font-medium">{error}</p>
            {Object.keys(errors).length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {Object.entries(errors).map(([id, message]) => (
                  <li key={id}>
                    <a href={`#${id}`} className="underline">
                      {message}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <section
          id="bs-sec-basics"
          aria-labelledby="bs-basics-heading"
          className="grid scroll-mt-20 gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
        >
          <div className="lg:col-span-2">
            <h2 id="bs-basics-heading" className="text-sm font-semibold">
              Basics
            </h2>
            <p className="text-xs text-muted-foreground">
              What it is, how critical it is, who owns it and which technical services it is made
              of.
            </p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="bs-name" className="text-sm font-semibold">
                Name
              </label>
              <Input
                id="bs-name"
                value={value.name}
                onChange={event => {
                  clear('bs-name');
                  set('name', event.target.value);
                }}
                placeholder="Checkout"
                maxLength={120}
                required
                {...errorProps(errors, 'bs-name')}
              />
              <FieldError id="bs-name" />
              <p className="text-xs text-muted-foreground">
                What customers call it. Shown on status pages and in incident impacts.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bs-description" className="text-sm font-semibold">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="bs-description"
                value={value.description}
                onChange={event => set('description', event.target.value)}
                placeholder="Cart, payment and order confirmation on web and mobile."
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bs-summary" className="text-sm font-semibold">
                Status page summary{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="bs-summary"
                value={value.statusPageSummary}
                onChange={event => set('statusPageSummary', event.target.value)}
                placeholder="Plain-language description for customers."
                maxLength={500}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bs-links" className="text-sm font-semibold">
                Links <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <LinkRowsField
                id="bs-links"
                text={value.linksText}
                onChange={next => {
                  clear('bs-links');
                  set('linksText', next);
                }}
                invalid={Boolean(errors['bs-links'])}
                describedBy={errors['bs-links'] ? 'bs-links-error' : undefined}
              />
              <FieldError id="bs-links" />
              <p className="text-xs text-muted-foreground">Runbooks, dashboards, docs.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="bs-criticality" className="text-sm font-semibold">
                  Criticality
                </label>
                <Select
                  value={value.criticality || NO_TEAM}
                  onValueChange={next =>
                    set(
                      'criticality',
                      next === NO_TEAM ? '' : (next as BusinessServiceFormValue['criticality'])
                    )
                  }
                >
                  <SelectTrigger id="bs-criticality">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEAM}>Not set</SelectItem>
                    {CRITICALITIES.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bs-team" className="text-sm font-semibold">
                  Owner team
                </label>
                <Select
                  value={value.ownerTeamId || NO_TEAM}
                  onValueChange={next => set('ownerTeamId', next === NO_TEAM ? '' : next)}
                >
                  <SelectTrigger id="bs-team">
                    <SelectValue placeholder="No owner" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TEAM}>No owner</SelectItem>
                    {teams.map(team => (
                      <SelectItem key={team.id} value={team.id}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <TeamBulkAdd teams={teams} onAdd={addTeamServices} />
            <MultiPicker
              label="Technical services"
              description="Open incidents on these services, and on what they depend on, set its status."
              options={serviceOptions}
              kind="services"
              value={value.memberServiceIds}
              onChange={next => set('memberServiceIds', next)}
              emptyText="No services match."
              rowAddon={option => {
                const critical = !value.nonCriticalServiceIds.includes(option.id);
                return (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        'w-[4.75rem] text-right text-xs',
                        critical ? 'font-medium text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {critical ? 'Critical' : 'Non-critical'}
                    </span>
                    <Switch
                      checked={critical}
                      aria-label={`${option.name} is critical (can take this business service down)`}
                      onCheckedChange={next =>
                        set(
                          'nonCriticalServiceIds',
                          next
                            ? value.nonCriticalServiceIds.filter(
                                serviceId => serviceId !== option.id
                              )
                            : [...value.nonCriticalServiceIds, option.id]
                        )
                      }
                    />
                  </span>
                );
              }}
            />
          </div>
        </section>

        <section
          id="bs-sec-ownership"
          aria-labelledby="bs-catalog-heading"
          className="scroll-mt-20 grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
        >
          <div className="space-y-4">
            <div>
              <h2 id="bs-catalog-heading" className="text-sm font-semibold">
                Ownership and SLO
              </h2>
              <p className="text-xs text-muted-foreground">
                All optional. Used for the catalog scorecard, the error budget and who is on call.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <PickField
                id="bs-owner-user"
                label="Owner (person)"
                none="No person"
                value={value.ownerUserId}
                options={users}
                onChange={next => set('ownerUserId', next)}
              />
              <PickField
                id="bs-policy"
                label="Escalation policy"
                none="None"
                value={value.escalationPolicyId}
                options={escalationPolicies}
                onChange={next => set('escalationPolicyId', next)}
              />
            </div>
            <TextField
              id="bs-contact"
              label="Contact channel"
              value={value.contactChannel}
              placeholder="#checkout-oncall"
              maxLength={200}
              onChange={next => set('contactChannel', next)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="bs-slo"
                label="SLO target (%)"
                value={value.sloTarget}
                placeholder="99.9"
                inputMode="decimal"
                onChange={next => set('sloTarget', next)}
              />
              <PickField
                id="bs-slo-window"
                label="SLO window"
                none="30 days"
                value={value.sloWindowDays === '30' ? '' : value.sloWindowDays}
                options={[
                  { id: '7', name: '7 days' },
                  { id: '90', name: '90 days' },
                ]}
                onChange={next => set('sloWindowDays', (next || '30') as '7' | '30' | '90')}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="bs-environment"
                label="Environment"
                value={value.environment}
                placeholder="production"
                maxLength={40}
                onChange={next => set('environment', next)}
              />
              <PickField
                id="bs-lifecycle"
                label="Lifecycle"
                none={LIFECYCLE_LABEL.ACTIVE}
                value={value.lifecycle === 'ACTIVE' ? '' : value.lifecycle}
                options={LIFECYCLES.filter(l => l !== 'ACTIVE').map(l => ({
                  id: l,
                  name: LIFECYCLE_LABEL[l],
                }))}
                onChange={next => set('lifecycle', (next || 'ACTIVE') as typeof value.lifecycle)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bs-tags" className="text-sm font-semibold">
                Tags
              </label>
              <TagChipsField
                id="bs-tags"
                text={value.tagsText}
                onChange={next => set('tagsText', next)}
              />
              <p className="text-xs text-muted-foreground">Press Enter or a comma to add a tag.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="bs-attributes" className="text-sm font-semibold">
                Custom attributes
              </label>
              <Textarea
                id="bs-attributes"
                value={value.attributesText}
                onChange={event => {
                  clear('bs-attributes');
                  set('attributesText', event.target.value);
                }}
                placeholder="cost_center = 4410"
                rows={3}
                {...errorProps(errors, 'bs-attributes')}
              />
              <FieldError id="bs-attributes" />
              <p className="text-xs text-muted-foreground">One key = value per line, up to 20.</p>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="bs-reviewed"
                checked={value.markReviewed}
                onCheckedChange={checked => set('markReviewed', checked === true)}
              />
              <label htmlFor="bs-reviewed">Mark as reviewed today</label>
            </div>
          </div>
        </section>

        <section
          id="bs-sec-customers"
          aria-labelledby="bs-customer-heading"
          className="scroll-mt-20 grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
        >
          <div className="space-y-4">
            <div>
              <h2 id="bs-customer-heading" className="text-sm font-semibold">
                Customer impact
              </h2>
              <p className="text-xs text-muted-foreground">
                Used to estimate what downtime costs and to lift health when customers report
                problems. All optional.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="bs-revenue"
                label="Revenue per hour of downtime"
                value={value.revenuePerHour ?? ''}
                placeholder="12000.00"
                inputMode="decimal"
                onChange={next => set('revenuePerHour', next)}
              />
              <TextField
                id="bs-currency"
                label="Currency"
                value={value.currency ?? 'USD'}
                maxLength={3}
                placeholder="USD"
                onChange={next => set('currency', next.toUpperCase())}
              />
            </div>
            <TextField
              id="bs-customers"
              label="Total customers"
              value={value.customersTotal ?? ''}
              placeholder="250000"
              inputMode="numeric"
              onChange={next => set('customersTotal', next)}
            />
          </div>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                id="bs-report-threshold"
                label="Customer reports to degrade"
                value={value.customerReportThreshold ?? ''}
                placeholder="Off"
                inputMode="numeric"
                onChange={next => set('customerReportThreshold', next)}
              />
              <TextField
                id="bs-report-window"
                label="Within (minutes)"
                value={value.customerReportWindowMinutes ?? ''}
                placeholder="60"
                inputMode="numeric"
                onChange={next => set('customerReportWindowMinutes', next)}
              />
            </div>
            <TextField
              id="bs-review-interval"
              label="Review every (days)"
              value={value.reviewIntervalDays ?? ''}
              placeholder="180"
              inputMode="numeric"
              onChange={next => set('reviewIntervalDays', next)}
            />
          </div>
        </section>

        <section
          id="bs-sec-impact"
          aria-labelledby="bs-impact-heading"
          className="scroll-mt-20 grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
        >
          <div className="space-y-4">
            <div>
              <h2 id="bs-impact-heading" className="text-sm font-semibold">
                What counts as impact
              </h2>
              <p className="text-xs text-muted-foreground">
                Incidents below these thresholds do not change its health. Leave them on the tier
                default unless this business service needs its own rule. Non-critical services (set
                in the list above) can only make it degraded.
              </p>
              {!value.criticality && (
                <p className="mt-1 text-xs text-status-elevated" role="note">
                  Criticality is not set, so every open incident on a member counts as impact. Pick
                  a tier to filter low-urgency noise.
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="bs-urgency" className="text-sm font-semibold">
                  Minimum urgency
                </label>
                <Select
                  value={value.impactMinUrgency || DEFAULT}
                  onValueChange={next =>
                    set(
                      'impactMinUrgency',
                      next === DEFAULT ? '' : (next as BusinessServiceFormValue['impactMinUrgency'])
                    )
                  }
                >
                  <SelectTrigger id="bs-urgency">
                    <SelectValue placeholder="Tier default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>Tier default</SelectItem>
                    {URGENCIES.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bs-priority" className="text-sm font-semibold">
                  Lowest priority
                </label>
                <Select
                  value={value.impactMaxPriority || DEFAULT}
                  onValueChange={next => set('impactMaxPriority', next === DEFAULT ? '' : next)}
                >
                  <SelectTrigger id="bs-priority">
                    <SelectValue placeholder="Tier default" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT}>Tier default</SelectItem>
                    {PRIORITIES.map(priority => (
                      <SelectItem key={priority} value={priority}>
                        {priority} and more severe
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <label htmlFor="bs-auto-publish" className="text-sm font-semibold">
                  Publish status page updates automatically
                </label>
                <p id="bs-auto-publish-hint" className="text-xs text-muted-foreground">
                  When this business service becomes impacted or recovers, OpsKnight drafts an
                  update on every status page that shows it. Turn this on to publish those updates
                  without waiting for approval. Best kept for Tier 0 services.
                </p>
              </div>
              <Switch
                id="bs-auto-publish"
                aria-describedby="bs-auto-publish-hint"
                checked={value.autoPublishStatusUpdates ?? false}
                onCheckedChange={next => set('autoPublishStatusUpdates', next)}
              />
            </div>
            <details
              open={advancedOpen}
              onToggle={event => setAdvancedOpen(event.currentTarget.open)}
              className="rounded-lg border px-3 py-2"
            >
              <summary className="cursor-pointer select-none text-sm font-semibold">
                Advanced: quorum and dependency depth
              </summary>
              <div className="mt-3 space-y-3">
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField
                    id="bs-quorum-partial"
                    label="Partial at (% down)"
                    value={value.quorumPartialPct}
                    placeholder="50"
                    inputMode="numeric"
                    onChange={next => set('quorumPartialPct', next)}
                  />
                  <TextField
                    id="bs-quorum-major"
                    label="Major at (% down)"
                    value={value.quorumMajorPct}
                    placeholder="100"
                    inputMode="numeric"
                    onChange={next => set('quorumMajorPct', next)}
                  />
                  <TextField
                    id="bs-hops"
                    label="Dependency hops (1-5)"
                    value={value.dependencyHopDepth}
                    inputMode="numeric"
                    onChange={next => set('dependencyHopDepth', next)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Quorum (optional): status follows the share of critical services impacted instead
                  of the worst one. Hops: how far down its services&apos; dependencies an incident
                  still counts.
                </p>
              </div>
            </details>
            <ImpactPreviewNote
              draft={{
                criticality: value.criticality || null,
                impactMinUrgency: value.impactMinUrgency || null,
                impactMaxPriority: value.impactMaxPriority || null,
                memberServiceIds: value.memberServiceIds,
              }}
            />
          </div>
          <MultiPicker
            label="Depends on business services"
            description="When one of these is impacted, this one is degraded too. A business service cannot depend on itself, directly or in a loop."
            options={businessServices}
            value={value.dependsOnBusinessServiceIds}
            onChange={next => set('dependsOnBusinessServiceIds', next)}
            emptyText="No other business services."
          />
        </section>

        <section
          id="bs-sec-people"
          aria-label="Followers and subscribers"
          className="scroll-mt-20 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6"
        >
          <MultiPicker
            label="Followers"
            description="People told in plain language when it is affected and when it recovers. In-app only; nobody is paged."
            options={users}
            kind="users"
            value={value.followerUserIds}
            onChange={next => set('followerUserIds', next)}
            emptyText="No people match."
          />
          <div className="mt-6">
            <MultiPicker
              label="Subscriber teams"
              description="Every member of these teams is told when it is affected."
              options={teams}
              value={value.teamSubscriberIds}
              onChange={next => set('teamSubscriberIds', next)}
              emptyText="No teams."
            />
          </div>
        </section>

        {canDelete && value.id && (
          <section
            aria-labelledby="bs-danger-heading"
            className={cn('rounded-xl border p-5 sm:p-6', toneClasses('critical').soft)}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 id="bs-danger-heading" className="text-sm font-semibold">
                  Danger zone
                </h2>
                <p className="text-xs">
                  Deleting removes it from status pages and stops updates to its followers. Its
                  technical services are not changed.
                </p>
              </div>
              <DeleteConfirmDialog
                title={`Delete ${value.name}?`}
                description="Status pages stop showing it and its followers stop getting updates. Its technical services are not changed."
                requireMatchText={value.name}
                confirmText="Delete business service"
                onConfirm={remove}
                disabled={isPending}
                trigger={
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isPending}
                    className="gap-1.5"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    Delete business service
                  </Button>
                }
              />
            </div>
          </section>
        )}

        <div
          id="bs-actions"
          tabIndex={-1}
          className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-1 py-3 backdrop-blur focus:outline-hidden supports-[backdrop-filter]:bg-background/80"
        >
          {dirty && (
            <p className="mr-auto text-xs text-muted-foreground" role="status">
              Unsaved changes
            </p>
          )}
          <Button asChild variant="outline">
            <Link href={value.id ? `/services/business/${value.id}` : '/services/business'}>
              Cancel
            </Link>
          </Button>
          <Button type="submit" disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {value.id ? 'Save changes' : 'Create business service'}
          </Button>
        </div>
      </form>
    </FormErrorsContext.Provider>
  );
}
