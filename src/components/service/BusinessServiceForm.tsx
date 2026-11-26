/* eslint-disable security/detect-object-injection -- keys are our own field ids and Zod issue paths, never free-form input */
'use client';

import { createContext, useContext, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Textarea } from '@/components/ui/shadcn/textarea';
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

export type BusinessServiceFormValue = {
  id?: string;
  name: string;
  description: string;
  /** Shown on status pages instead of the description. */
  statusPageSummary: string;
  /** One "Label | https://url" per line. */
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
};
const LIFECYCLES = ['ACTIVE', 'BETA', 'DEPRECATED', 'RETIRED'] as const;
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
    <p
      id={`${id}-error`}
      className="text-xs font-medium text-status-critical-deep dark:text-rose-300"
    >
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
      found['bs-links'] =
        'Links need a label and an https URL, one per line ("Runbook | https://..."), up to 10.';
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
      router.push(`/services/business/${result.id}`);
      router.refresh();
    });
  };

  const remove = async () => {
    if (!value.id) return;
    const result = await deleteBusinessServiceAction(value.id);
    if (!result.ok) return { error: result.error };
    notify.success('Business service deleted');
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
        <nav aria-label="Form sections" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <a
            href="#bs-sec-basics"
            className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Basics
          </a>
          <a
            href="#bs-sec-ownership"
            className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Ownership and SLO
          </a>
          <a
            href="#bs-sec-customers"
            className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Customer impact
          </a>
          <a
            href="#bs-sec-impact"
            className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            What counts as impact
          </a>
          <a
            href="#bs-sec-people"
            className="font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            Followers
          </a>
        </nav>
        {(error || Object.keys(errors).length > 0) && (
          <div
            role="alert"
            className="rounded-lg border border-status-critical-border/30 bg-status-critical-soft px-3 py-2 text-sm text-status-critical-deep dark:bg-status-critical/15 dark:text-rose-300"
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
          aria-label="Basics"
          className="grid scroll-mt-20 gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
        >
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
              <Textarea
                id="bs-links"
                value={value.linksText}
                onChange={event => {
                  clear('bs-links');
                  set('linksText', event.target.value);
                }}
                placeholder="Runbook | https://wiki.example.com/checkout"
                rows={3}
                {...errorProps(errors, 'bs-links')}
              />
              <FieldError id="bs-links" />
              <p className="text-xs text-muted-foreground">
                One per line as Label | https URL. Runbooks, dashboards, docs.
              </p>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={critical}
                    aria-label={`Critical: ${option.name}`}
                    className={cn(
                      'h-7 px-2 text-xs',
                      !critical && 'text-muted-foreground line-through'
                    )}
                    onClick={() =>
                      set(
                        'nonCriticalServiceIds',
                        critical
                          ? [...value.nonCriticalServiceIds, option.id]
                          : value.nonCriticalServiceIds.filter(serviceId => serviceId !== option.id)
                      )
                    }
                  >
                    Critical
                  </Button>
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
                none="Active"
                value={value.lifecycle === 'ACTIVE' ? '' : value.lifecycle}
                options={LIFECYCLES.filter(l => l !== 'ACTIVE').map(l => ({ id: l, name: l }))}
                onChange={next => set('lifecycle', (next || 'ACTIVE') as typeof value.lifecycle)}
              />
            </div>
            <TextField
              id="bs-tags"
              label="Tags (comma separated)"
              value={value.tagsText}
              placeholder="payments, pci"
              onChange={next => set('tagsText', next)}
            />
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.markReviewed}
                onChange={event => set('markReviewed', event.target.checked)}
              />
              Mark as reviewed today
            </label>
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
              label="Customers exposed"
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
              Quorum (optional): status follows the share of critical services impacted instead of
              the worst one. Hops: how far down its services&apos; dependencies an incident still
              counts.
            </p>
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

        <div
          id="bs-actions"
          tabIndex={-1}
          className="flex flex-col-reverse gap-3 focus:outline-hidden sm:flex-row sm:items-center sm:justify-between"
        >
          {canDelete && value.id ? (
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
                  variant="ghost"
                  disabled={isPending}
                  className="gap-1.5 text-status-critical-deep hover:bg-status-critical-soft dark:text-rose-300"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  Delete
                </Button>
              }
            />
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/services/business')}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="gap-1.5">
              {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {value.id ? 'Save changes' : 'Create business service'}
            </Button>
          </div>
        </div>
      </form>
    </FormErrorsContext.Provider>
  );
}
