'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { createRuleAction } from '@/app/(app)/settings/intelligence/noise-controls/actions';
import {
  previewMatchersAction,
  previewRuleAction,
} from '@/app/(app)/settings/intelligence/noise-controls/preview-actions';
import { Button } from '@/components/ui/shadcn/button';
import {
  emptyMatcher,
  validateMatcherDrafts,
  type MatcherDraft,
} from '@/lib/intelligence/noise-controls/builders';
import type { MatchPreview } from '@/lib/intelligence/noise-controls/preview';
import type { SimulationOutcome } from '@/lib/intelligence/noise-controls/simulation';
import MatcherRows from './MatcherRows';
import {
  ActionMessage,
  FieldError,
  fieldClass,
  fromLocalInput,
  initialActionState,
  labelClass,
  ReplaySummary,
  touchButton,
  useFormatAt,
  type Option,
} from './shared';

const EXPIRY_PRESETS = [
  { id: '1d', label: 'In 1 day', days: 1 },
  { id: '7d', label: 'In 7 days', days: 7 },
  { id: '30d', label: 'In 30 days', days: 30 },
  { id: '90d', label: 'In 90 days', days: 90 },
  { id: 'never', label: 'Never', days: null },
  { id: 'custom', label: 'On a date…', days: null },
] as const;
type ExpiryPreset = (typeof EXPIRY_PRESETS)[number]['id'];

export const LIVE_PREVIEW_DELAY_MS = 600;

export function expiryFor(preset: ExpiryPreset, custom: string, now: Date): Date | null {
  const match = EXPIRY_PRESETS.find(item => item.id === preset);
  if (match?.days) return new Date(now.getTime() + match.days * 86_400_000);
  if (preset === 'custom') return fromLocalInput(custom);
  return null;
}

/**
 * Suppression-rule builder: conditions, scope, effect, owner and expiry, with a live count of how many
 * of the last week's alerts the conditions match, and a full 7-day replay of the rule on its own.
 * Saving goes through the existing `createRuleAction`.
 */
export default function SuppressionRuleBuilder({
  services,
  owners,
  currentUserId,
}: {
  services: Option[];
  owners: Option[];
  currentUserId: string;
}) {
  const id = useId();
  const formatAt = useFormatAt();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [rows, setRows] = useState<MatcherDraft[]>([emptyMatcher()]);
  const [effect, setEffect] = useState<'SUPPRESS' | 'DOWNGRADE'>('SUPPRESS');
  const [downgradeUrgency, setDowngradeUrgency] = useState<'LOW' | 'MEDIUM'>('LOW');
  const [ownerId, setOwnerId] = useState(currentUserId);
  const [expiry, setExpiry] = useState<ExpiryPreset>('30d');
  const [customExpiry, setCustomExpiry] = useState('');
  const [errors, setErrors] = useState<{
    name?: string;
    expiry?: string;
    rows?: Array<string | null>;
  }>({});
  const [result, setResult] = useState(initialActionState);
  const [live, setLive] = useState<{
    state: 'idle' | 'loading' | 'ready' | 'error';
    data?: MatchPreview;
    message?: string;
  }>({ state: 'idle' });
  const [replay, setReplay] = useState<SimulationOutcome | null>(null);
  const [replayError, setReplayError] = useState('');
  const [saving, startSave] = useTransition();
  const [replaying, startReplay] = useTransition();
  const request = useRef(0);

  const { matchers } = validateMatcherDrafts(rows);
  const matcherKey = matchers ? JSON.stringify(matchers) : '';

  // Live match preview: debounced, only for valid conditions, and stale answers are ignored.
  useEffect(() => {
    if (!matcherKey) {
      request.current += 1; // Drop any answer still in flight for the previous conditions.
      return;
    }
    const ticket = ++request.current;
    const timer = setTimeout(async () => {
      setLive(current => ({ ...current, state: 'loading' }));
      const response = await previewMatchersAction({
        matchers: JSON.parse(matcherKey),
        serviceId: serviceId || null,
      }).catch(() => ({ ok: false as const, message: 'The preview could not run.' }));
      if (ticket !== request.current) return;
      setLive(
        response.ok
          ? { state: 'ready', data: response.data }
          : { state: 'error', message: response.message }
      );
    }, LIVE_PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [matcherKey, serviceId]);

  const buildInput = (): Record<string, unknown> | null => {
    const found: typeof errors = {};
    if (!name.trim()) found.name = 'Give the rule a name.';
    const checked = validateMatcherDrafts(rows);
    if (!checked.matchers) found.rows = checked.errors;
    const expiresAt = expiryFor(expiry, customExpiry, new Date());
    if (expiry === 'custom' && !expiresAt) found.expiry = 'Enter an expiry date.';
    else if (expiresAt && expiresAt.getTime() <= Date.now())
      found.expiry = 'The expiry must be in the future.';
    setErrors(found);
    if (found.name || found.rows || found.expiry || !checked.matchers) return null;
    return {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      serviceId: serviceId || null,
      matchers: checked.matchers,
      effect,
      ...(effect === 'DOWNGRADE' ? { downgradeUrgency } : {}),
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      ownerId: ownerId || null,
    };
  };

  const runReplay = () => {
    const input = buildInput();
    if (!input) return;
    setReplayError('');
    startReplay(async () => {
      const response = await previewRuleAction(input);
      if (response.ok) setReplay(response.data);
      else setReplayError(response.message);
    });
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const input = buildInput();
    if (!input) return;
    const form = new FormData();
    form.set('name', String(input.name));
    if (input.description) form.set('description', String(input.description));
    if (input.serviceId) form.set('serviceId', String(input.serviceId));
    form.set('matchers', JSON.stringify(input.matchers));
    form.set('effect', effect);
    if (effect === 'DOWNGRADE') form.set('downgradeUrgency', downgradeUrgency);
    if (input.expiresAt) form.set('expiresAt', String(input.expiresAt));
    if (input.ownerId) form.set('ownerId', String(input.ownerId));
    startSave(async () => {
      const response = await createRuleAction(initialActionState, form);
      setResult(response);
      if (response.ok) {
        setName('');
        setDescription('');
        setRows([emptyMatcher()]);
        setReplay(null);
      }
    });
  };

  return (
    <form
      onSubmit={save}
      noValidate
      aria-label="New suppression rule"
      className="space-y-4 rounded-lg border border-border p-3 sm:p-4"
    >
      <h3 className="text-sm font-semibold">New suppression rule</h3>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-name`} className={labelClass}>
            Name
          </label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={120}
            onChange={event => {
              setName(event.target.value);
              setErrors(current => ({ ...current, name: undefined }));
            }}
            className={fieldClass}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
          />
          <FieldError id={`${id}-name-error`} message={errors.name} />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <label htmlFor={`${id}-service`} className={labelClass}>
            Service
          </label>
          <select
            id={`${id}-service`}
            value={serviceId}
            onChange={event => setServiceId(event.target.value)}
            className={fieldClass}
          >
            <option value="">Any service</option>
            {services.map(service => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:col-span-4">
          <label htmlFor={`${id}-description`} className={labelClass}>
            Why (optional)
          </label>
          <input
            id={`${id}-description`}
            value={description}
            maxLength={500}
            onChange={event => setDescription(event.target.value)}
            className={fieldClass}
            placeholder="Known noisy check during the migration"
          />
        </div>
      </div>

      <MatcherRows
        rows={rows}
        onChange={next => {
          setRows(next);
          setErrors(current => ({ ...current, rows: undefined }));
          setReplay(null);
        }}
        errors={errors.rows}
      />

      <div
        aria-live="polite"
        aria-atomic="true"
        className="text-sm"
        data-testid="live-match-preview"
      >
        {(!matcherKey || live.state === 'idle') && (
          <p className="text-xs text-muted-foreground">
            Complete the conditions to see how many recent alerts they match.
          </p>
        )}
        {matcherKey && live.state === 'loading' && !live.data && (
          <p className="text-xs text-muted-foreground">Checking the last 7 days…</p>
        )}
        {matcherKey && live.state === 'error' && (
          <p className="text-xs text-destructive">{live.message}</p>
        )}
        {matcherKey && live.data && live.state !== 'error' && (
          <div className="space-y-1">
            <p className="text-sm">
              Matches <strong>{live.data.matchedAlerts}</strong> of{' '}
              {live.data.alertsScanned.toLocaleString('en-US')} alerts ({live.data.matchedIncidents}{' '}
              incident{live.data.matchedIncidents === 1 ? '' : 's'}) in the last {live.data.days}{' '}
              days
              {live.data.truncated ? ', most recent alerts only' : ''}.
              {live.state === 'loading' && (
                <span className="text-muted-foreground"> Updating…</span>
              )}
            </p>
            {live.data.examples.length > 0 && (
              <ul
                className="space-y-0.5 text-xs text-muted-foreground"
                aria-label="Matching alerts"
              >
                {live.data.examples.map(example => (
                  <li key={example.incidentId}>
                    <a
                      className="underline-offset-2 hover:underline"
                      href={`/incidents/${example.incidentId}`}
                    >
                      {example.summary || example.incidentId}
                    </a>{' '}
                    · {example.source}
                    {example.severity ? ` · ${example.severity}` : ''} · {formatAt(example.at)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor={`${id}-effect`} className={labelClass}>
            Effect
          </label>
          <select
            id={`${id}-effect`}
            value={effect}
            onChange={event => setEffect(event.target.value as 'SUPPRESS' | 'DOWNGRADE')}
            className={fieldClass}
          >
            <option value="SUPPRESS">Suppress (never page)</option>
            <option value="DOWNGRADE">Downgrade urgency</option>
          </select>
        </div>
        {effect === 'DOWNGRADE' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-du`} className={labelClass}>
              Downgrade to
            </label>
            <select
              id={`${id}-du`}
              value={downgradeUrgency}
              onChange={event => setDowngradeUrgency(event.target.value as 'LOW' | 'MEDIUM')}
              className={fieldClass}
            >
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor={`${id}-owner`} className={labelClass}>
            Owner
          </label>
          <select
            id={`${id}-owner`}
            value={ownerId}
            onChange={event => setOwnerId(event.target.value)}
            className={fieldClass}
          >
            {owners.map(owner => (
              <option key={owner.id} value={owner.id}>
                {owner.id === currentUserId ? `${owner.name} (you)` : owner.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-expiry`} className={labelClass}>
            Expires
          </label>
          <select
            id={`${id}-expiry`}
            value={expiry}
            onChange={event => {
              setExpiry(event.target.value as ExpiryPreset);
              setErrors(current => ({ ...current, expiry: undefined }));
            }}
            className={fieldClass}
            aria-invalid={errors.expiry ? true : undefined}
            aria-describedby={errors.expiry ? `${id}-expiry-error` : undefined}
          >
            {EXPIRY_PRESETS.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <FieldError id={`${id}-expiry-error`} message={errors.expiry} />
        </div>
        {expiry === 'custom' && (
          <div className="space-y-1">
            <label htmlFor={`${id}-expiry-at`} className={labelClass}>
              Expiry date (your time)
            </label>
            <input
              id={`${id}-expiry-at`}
              type="datetime-local"
              value={customExpiry}
              onChange={event => setCustomExpiry(event.target.value)}
              className={fieldClass}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={saving} className={touchButton}>
          {saving ? 'Saving…' : 'Add rule'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={replaying}
          onClick={runReplay}
          className={touchButton}
        >
          {replaying ? 'Replaying…' : 'Test against the last 7 days'}
        </Button>
      </div>
      <ActionMessage state={result} />
      <div aria-live="polite" aria-busy={replaying}>
        {replayError && (
          <p role="alert" className="text-sm text-destructive">
            {replayError}
          </p>
        )}
        {replay && (
          <ReplaySummary
            outcome={replay}
            note="Only this rule was applied, as if it had been live all week; other controls were off."
          />
        )}
      </div>
    </form>
  );
}
