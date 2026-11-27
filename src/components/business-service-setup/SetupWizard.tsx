'use client';
/* eslint-disable security/detect-object-injection -- lookups are keyed by typed enum values (tier, step), never request input */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Textarea } from '@/components/ui/shadcn/textarea';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import { CRITICALITY_HINT, CRITICALITY_LABEL } from '@/components/business-service/HealthBadge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { notify } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  createFromSetupAction,
  suggestMembersAction,
} from '@/app/(app)/services/business/setup/actions';

type Option = { id: string; name: string; hint?: string | null };

export type SetupWizardProps = {
  services: Option[];
  teams: Option[];
  /** Empty when the person cannot manage status pages; the step then explains why. */
  statusPages: Option[];
};

const STEPS = ['Name', 'Services', 'Ownership', 'Status pages', 'Subscribers', 'Review'] as const;
const STEP_HINT: Record<(typeof STEPS)[number], string> = {
  Name: 'What customers rely on, in their words.',
  Services: 'The technical services behind it; their incidents set its health.',
  Ownership: 'Who owns it and which incidents count as impact.',
  'Status pages': 'Where customers see its health.',
  Subscribers: 'Who hears about it when it is affected.',
  Review: 'Check everything before creating it.',
};
const DEFAULT = '__default__';
const TIERS = ['TIER_0', 'TIER_1', 'TIER_2', 'TIER_3'] as const;
const TIER_OPTIONS = TIERS.map(tier => ({
  value: tier,
  label: `${CRITICALITY_LABEL[tier]} · ${CRITICALITY_HINT[tier]}`,
}));

/** Searchable checklist; chosen rows stay on top so the selection is visible. */
function CheckList({
  label,
  options,
  value,
  onChange,
  emptyText,
}: {
  label: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
}) {
  const [query, setQuery] = useState('');
  const chosen = new Set(value);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .filter(option => !needle || option.name.toLowerCase().includes(needle))
      .sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)))
      .slice(0, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sort only when the query or options change
  }, [query, options]);
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        {label} <span className="text-muted-foreground">({value.length} selected)</span>
      </legend>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search"
          aria-label={`Search ${label.toLowerCase()}`}
          className="pl-8"
        />
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        {visible.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          visible.map(option => {
            const checked = chosen.has(option.id);
            return (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0',
                  checked ? 'bg-primary/5' : 'hover:bg-muted/40'
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(checked ? value.filter(id => id !== option.id) : [...value, option.id])
                  }
                  className="h-4 w-4 rounded border-border"
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {option.hint && (
                  <span className="truncate text-xs text-muted-foreground">{option.hint}</span>
                )}
              </label>
            );
          })
        )}
      </div>
    </fieldset>
  );
}

/** Guided creation: name → members → ownership and thresholds → status pages → subscribers. */
export default function SetupWizard({ services, teams, statusPages }: SetupWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Option[]>([]);
  const [ownerTeamId, setOwnerTeamId] = useState(DEFAULT);
  const [criticality, setCriticality] = useState(DEFAULT);
  const [minUrgency, setMinUrgency] = useState(DEFAULT);
  const [maxPriority, setMaxPriority] = useState(DEFAULT);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [subscribeAll, setSubscribeAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Separate flags: finding suggestions must not look like (or block) creating the service.
  const [suggesting, startSuggesting] = useTransition();
  const [creating, startCreating] = useTransition();
  const serviceName = new Map(services.map(service => [service.id, service.name]));
  const optionName = (options: Option[], id: string) =>
    options.find(option => option.id === id)?.name ?? id;
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  useEffect(() => {
    // Move focus to the new step's heading after a step change, not on first render.
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  const canContinue = step !== 0 || name.trim().length > 0;
  const last = step === STEPS.length - 1;

  const refreshSuggestions = (next: string[]) =>
    startSuggesting(async () => {
      const found = await suggestMembersAction(next);
      setSuggestions(found.filter(item => !next.includes(item.id)));
    });

  const goNext = () => {
    setError(null);
    setStep(current => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = () =>
    startCreating(async () => {
      setError(null);
      const picked = (value: string) => (value === DEFAULT ? null : value);
      const result = await createFromSetupAction({
        name,
        description: description.trim() || null,
        memberServiceIds: members,
        ownerTeamId: picked(ownerTeamId),
        criticality: picked(criticality) as 'TIER_0' | null,
        impactMinUrgency: picked(minUrgency) as 'HIGH' | null,
        impactMaxPriority: picked(maxPriority),
        statusPageIds: pageIds,
        subscriberTeamIds: teamIds,
        subscribeAllUsers: subscribeAll,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      for (const warning of result.warnings) notify.warning(warning);
      notify.success(`${name.trim()} created`);
      router.push(`/services/business/${result.id}`);
    });

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="Setup steps">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
              aria-current={index === step ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                index === step
                  ? 'border-primary bg-primary/10 text-primary'
                  : index < step
                    ? 'border-border text-foreground hover:bg-muted'
                    : 'border-border text-muted-foreground'
              )}
            >
              {index < step ? <Check className="h-3 w-3" aria-hidden /> : <span>{index + 1}</span>}
              {label}
            </button>
          </li>
        ))}
      </ol>

      <section
        aria-labelledby="bs-setup-step"
        className="space-y-4 rounded-xl border border-border bg-card p-4 md:p-6"
      >
        <div>
          <h2
            id="bs-setup-step"
            ref={heading}
            tabIndex={-1}
            className="text-base font-semibold focus:outline-hidden"
          >
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </h2>
          <p className="text-xs text-muted-foreground">{STEP_HINT[STEPS[step]]}</p>
        </div>
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="bs-setup-name">Name</Label>
              <Input
                id="bs-setup-name"
                value={name}
                maxLength={120}
                onChange={event => setName(event.target.value)}
                placeholder="Checkout"
              />
              <p className="text-xs text-muted-foreground">
                What customers rely on, in their words: Checkout, Payments, Sign-in.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-setup-description">Description</Label>
              <Textarea
                id="bs-setup-description"
                value={description}
                maxLength={2000}
                rows={3}
                onChange={event => setDescription(event.target.value)}
              />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <CheckList
              label="Technical services"
              options={services}
              value={members}
              onChange={next => {
                setMembers(next);
                setSuggestions(current => current.filter(row => !next.includes(row.id)));
              }}
              emptyText="No services match."
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!members.length || suggesting}
              onClick={() => refreshSuggestions(members)}
            >
              Suggest related services
            </Button>
            {(suggesting || suggestions.length > 0) && (
              <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                <p className="text-sm font-medium">Suggested from dependencies</p>
                {suggesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading suggestions" />
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {suggestions.map(item => (
                      <li key={item.id}>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 text-xs"
                          onClick={() => {
                            setMembers(current => [...current, item.id]);
                            setSuggestions(current => current.filter(row => row.id !== item.id));
                          }}
                        >
                          <Plus className="h-3 w-3" aria-hidden />
                          {item.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">
                  Your chosen services depend on these. Add them if an outage there takes this
                  business service down too.
                </p>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <PickOne
                id="bs-setup-owner"
                label="Owner team"
                value={ownerTeamId}
                onChange={setOwnerTeamId}
                defaultLabel="No owner"
                options={teams.map(team => ({ value: team.id, label: team.name }))}
              />
              <PickOne
                id="bs-setup-criticality"
                label="Criticality"
                value={criticality}
                onChange={setCriticality}
                defaultLabel="Not set"
                options={TIER_OPTIONS}
              />
              <PickOne
                id="bs-setup-urgency"
                label="Counts as impacted from urgency"
                value={minUrgency}
                onChange={setMinUrgency}
                defaultLabel="Tier default"
                options={['HIGH', 'MEDIUM', 'LOW'].map(value => ({
                  value,
                  label: value.charAt(0) + value.slice(1).toLowerCase(),
                }))}
              />
              <PickOne
                id="bs-setup-priority"
                label="Counts as impacted up to priority"
                value={maxPriority}
                onChange={setMaxPriority}
                defaultLabel="Tier default"
                options={['P1', 'P2', 'P3', 'P4', 'P5'].map(value => ({ value, label: value }))}
              />
            </div>
          </div>
        )}

        {step === 3 &&
          (statusPages.length ? (
            <CheckList
              label="Show on status pages"
              options={statusPages}
              value={pageIds}
              onChange={setPageIds}
              emptyText="No status pages match."
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No status pages you can manage. A status page admin can add this business service
              later from the page settings.
            </p>
          ))}

        {step === 4 && (
          <div className="space-y-4">
            <CheckList
              label="Teams to keep informed"
              options={teams}
              value={teamIds}
              onChange={setTeamIds}
              emptyText="No teams match."
            />
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id="bs-setup-subscribe-all"
                checked={subscribeAll}
                onCheckedChange={checked => setSubscribeAll(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="bs-setup-subscribe-all">
                Subscribe all users
                <span className="block text-xs text-muted-foreground">
                  Everyone active today follows it and gets stakeholder updates (never pages).
                  People can unfollow.
                </span>
              </label>
            </div>
          </div>
        )}

        {step === 5 && (
          <dl
            aria-label="Review"
            className="grid gap-x-4 gap-y-2 rounded-lg bg-muted/40 p-3 text-sm md:grid-cols-[10rem_1fr_auto]"
          >
            {(
              [
                ['Name', name.trim() + (description.trim() ? ` — ${description.trim()}` : ''), 0],
                [
                  'Services',
                  members.map(id => serviceName.get(id) ?? id).join(', ') || 'None yet',
                  1,
                ],
                [
                  'Owner and tier',
                  [
                    ownerTeamId === DEFAULT ? 'No owner' : optionName(teams, ownerTeamId),
                    criticality === DEFAULT
                      ? 'Criticality not set'
                      : (TIER_OPTIONS.find(option => option.value === criticality)?.label ??
                        criticality),
                  ].join(' · '),
                  2,
                ],
                [
                  'Status pages',
                  pageIds.map(id => optionName(statusPages, id)).join(', ') || 'None',
                  3,
                ],
                [
                  'Subscribers',
                  [
                    teamIds.map(id => optionName(teams, id)).join(', '),
                    subscribeAll ? 'All users' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'None',
                  4,
                ],
              ] as const
            ).map(([label, text, target]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words">{text}</dd>
                <dd>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    aria-label={`Edit ${label.toLowerCase()}`}
                    onClick={() => setStep(target)}
                  >
                    Edit
                  </Button>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={step === 0 || creating}
          onClick={() => setStep(current => current - 1)}
        >
          Back
        </Button>
        {last ? (
          <Button type="button" onClick={submit} disabled={creating || !name.trim()}>
            {creating ? 'Creating…' : 'Create business service'}
          </Button>
        ) : (
          <Button type="button" onClick={goNext} disabled={!canContinue}>
            Continue
          </Button>
        )}
      </div>
    </div>
  );
}

function PickOne({
  id,
  label,
  value,
  onChange,
  defaultLabel,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>{defaultLabel}</SelectItem>
          {options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
