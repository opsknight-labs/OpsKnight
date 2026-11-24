'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Search, Trash2 } from 'lucide-react';
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
import {
  createBusinessServiceAction,
  deleteBusinessServiceAction,
  searchBusinessServiceOptionsAction,
  updateBusinessServiceAction,
} from '@/app/(app)/services/business/actions';

type Option = { id: string; name: string; hint?: string | null };

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

/** Pick many from a searchable list; selected rows stay on top so the choice is visible. */
function MultiPicker({
  label,
  description,
  options: initialOptions,
  kind,
  value,
  onChange,
  emptyText,
  rowAddon,
}: {
  label: string;
  description: string;
  options: Option[];
  /** Searches the server as the user types; the initial list is only the first page. Omit to filter `options` locally. */
  kind?: 'services' | 'users';
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  /** Extra control beside a selected row (outside its label, so controls never nest). */
  rowAddon?: (option: Option) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState(initialOptions);
  const selected = new Set(value);
  useEffect(() => {
    const needle = query.trim();
    if (!needle || !kind) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBusinessServiceOptionsAction(kind, needle)
        .then(found => {
          if (cancelled) return;
          setOptions(current => {
            const known = new Set(current.map(option => option.id));
            return [...current, ...found.filter(option => !known.has(option.id))];
          });
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .filter(
        option =>
          !needle ||
          option.name.toLowerCase().includes(needle) ||
          !!option.hint?.toLowerCase().includes(needle)
      )
      .sort((a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sort on selection is intentional
  }, [options, query, value]);
  const id = label.toLowerCase().replace(/\s+/g, '-');
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-foreground">
        {label}{' '}
        <span className="font-normal text-muted-foreground tabular-nums">({value.length})</span>
      </legend>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={`${id}-search`}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`Search ${label.toLowerCase()}`}
          aria-label={`Search ${label.toLowerCase()}`}
          className="h-9 pl-8 text-sm"
        />
      </div>
      <ul
        className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border"
        aria-label={label}
      >
        {visible.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</li>
        ) : (
          visible.map(option => {
            const checked = selected.has(option.id);
            return (
              <li key={option.id} className={cn('flex items-center', checked && 'bg-muted/30')}>
                <label
                  className={cn(
                    'flex min-h-10 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted/50'
                  )}
                >
                  <input
                    type="checkbox"
                    className="peer sr-only"
                    checked={checked}
                    onChange={() =>
                      onChange(
                        checked ? value.filter(item => item !== option.id) : [...value, option.id]
                      )
                    }
                  />
                  <span
                    aria-hidden
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring',
                      checked
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background'
                    )}
                  >
                    {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
                  {option.hint && (
                    <span className="shrink-0 truncate text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  )}
                </label>
                {checked && rowAddon && <span className="shrink-0 pr-2">{rowAddon(option)}</span>}
              </li>
            );
          })
        )}
      </ul>
    </fieldset>
  );
}

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
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <Input
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
      />
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
  const [isPending, startTransition] = useTransition();
  const set = <K extends keyof BusinessServiceFormValue>(
    key: K,
    next: BusinessServiceFormValue[K]
  ) => setValue(current => ({ ...current, [key]: next }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.name.trim()) {
      setError('Give the business service a name.');
      return;
    }
    const links = linksFromLines(value.linksText);
    if (!links) {
      setError(
        'Links need a label and an https URL, one per line ("Runbook | https://..."), up to 10.'
      );
      return;
    }
    const attributes = attributesFromLines(value.attributesText);
    if (!attributes) {
      setError('Custom attributes: one "key = value" per line, at most 20, keys like cost_center.');
      return;
    }
    const slo = pct(value.sloTarget);
    if (slo !== null && !(slo >= 90 && slo <= 99.999)) {
      setError('SLO target must be between 90 and 99.999 percent.');
      return;
    }
    const partial = pct(value.quorumPartialPct);
    const major = pct(value.quorumMajorPct);
    if (
      [partial, major].some(n => n !== null && !(Number.isInteger(n) && n >= 1 && n <= 100)) ||
      (partial !== null && major !== null && partial > major)
    ) {
      setError('Quorum thresholds are whole percents from 1 to 100; partial cannot exceed major.');
      return;
    }
    const customers = pct(value.customersTotal ?? '');
    const revenue = (value.revenuePerHour ?? '').trim() ? moneyToCents(value.revenuePerHour ?? '') : null;
    const reportThreshold = pct(value.customerReportThreshold ?? '');
    const reportWindow = pct(value.customerReportWindowMinutes ?? '');
    const reviewDays = pct(value.reviewIntervalDays ?? '');
    const whole = (n: number | null, min: number, max: number) =>
      n === null || (Number.isInteger(n) && n >= min && n <= max);
    if (
      ((value.revenuePerHour ?? '').trim() !== '' && revenue === null) ||
      !whole(customers, 0, 1_000_000_000) ||
      !whole(reportThreshold, 1, 100_000) ||
      !whole(reportWindow, 5, 1440) ||
      !whole(reviewDays, 7, 730) ||
      !/^[A-Za-z]{3}$/.test(value.currency ?? 'USD')
    ) {
      setError(
        'Customer impact: revenue is an amount like 12000.50, customers a whole number, report threshold 1+, window 5 to 1440 minutes, review interval 7 to 730 days, currency a 3-letter code.'
      );
      return;
    }
    setError(null);
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
        setError(result.error);
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
    <form onSubmit={submit} className="space-y-6" noValidate>
      <section className="grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="bs-name" className="text-sm font-semibold">
              Name
            </label>
            <Input
              id="bs-name"
              value={value.name}
              onChange={event => set('name', event.target.value)}
              placeholder="Checkout"
              maxLength={120}
              aria-invalid={error !== null && !value.name.trim()}
              required
            />
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
              onChange={event => set('linksText', event.target.value)}
              placeholder="Runbook | https://wiki.example.com/checkout"
              rows={3}
            />
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
        <MultiPicker
          label="Technical services"
          description="Open incidents on these services, and on what they depend on, set its status."
          options={services}
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
                aria-label={`${option.name}: ${critical ? 'critical' : 'non-critical'}. Toggle`}
                className="h-7 px-2 text-xs"
                onClick={() =>
                  set(
                    'nonCriticalServiceIds',
                    critical
                      ? [...value.nonCriticalServiceIds, option.id]
                      : value.nonCriticalServiceIds.filter(serviceId => serviceId !== option.id)
                  )
                }
              >
                {critical ? 'Critical' : 'Non-critical'}
              </Button>
            );
          }}
        />
      </section>

      <section
        aria-labelledby="bs-catalog-heading"
        className="grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
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
              onChange={event => set('attributesText', event.target.value)}
              placeholder="cost_center = 4410"
              rows={3}
            />
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
        aria-labelledby="bs-customer-heading"
        className="grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
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
        aria-labelledby="bs-impact-heading"
        className="grid gap-6 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6 lg:grid-cols-2"
      >
        <div className="space-y-4">
          <div>
            <h2 id="bs-impact-heading" className="text-sm font-semibold">
              What counts as impact
            </h2>
            <p className="text-xs text-muted-foreground">
              Incidents below these thresholds do not change its health. Leave them on the tier
              default unless this business service needs its own rule. Non-critical services (set in
              the list above) can only make it degraded.
            </p>
            {!value.criticality && (
              <p className="mt-1 text-xs text-status-elevated" role="note">
                Criticality is not set, so every open incident on a member counts as impact. Pick a
                tier to filter low-urgency noise.
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
            Quorum (optional): status follows the share of critical services impacted instead of the
            worst one. Hops: how far down its services&apos; dependencies an incident still counts.
          </p>
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

      <section className="rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6">
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

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-status-critical-border/30 bg-status-critical-soft px-3 py-2 text-sm text-status-critical-deep dark:bg-status-critical/15 dark:text-rose-300"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          <Button type="button" variant="outline" onClick={() => router.push('/services/business')}>
            Cancel
          </Button>
          <Button type="submit" disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {value.id ? 'Save changes' : 'Create business service'}
          </Button>
        </div>
      </div>
    </form>
  );
}
