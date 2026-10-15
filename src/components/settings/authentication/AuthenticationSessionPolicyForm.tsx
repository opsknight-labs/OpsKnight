'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/shadcn/button';
import { useAuthenticationWorkspace } from './useAuthenticationController';

export function readableDuration(seconds: number | undefined) {
  if (seconds == null) return 'Not reported';
  if (seconds % 86400 === 0) return `${seconds / 86400} ${seconds === 86400 ? 'day' : 'days'}`;
  if (seconds % 3600 === 0) return `${seconds / 3600} ${seconds === 3600 ? 'hour' : 'hours'}`;
  return `${Math.round((seconds / 60) * 100) / 100} minutes`;
}
function DurationField({
  label,
  value,
  inherited,
  presets,
  min,
  max,
  onChange,
  error,
  id,
  disabled,
}: {
  label: string;
  value: number | null;
  inherited: number | undefined;
  presets: number[];
  min: number;
  max: number;
  onChange: (value: number | null) => void;
  error?: string;
  id: string;
  disabled: boolean;
}) {
  const [custom, setCustom] = useState(value !== null && !presets.includes(value));
  const [unit, setUnit] = useState(3600);
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={
          custom
            ? 'custom'
            : value === null
              ? 'default'
              : presets.includes(value)
                ? String(value)
                : 'custom'
        }
        onChange={event => {
          if (event.target.value === 'custom') {
            setCustom(true);
            onChange(value ?? inherited ?? min);
          } else {
            setCustom(false);
            onChange(event.target.value === 'default' ? null : Number(event.target.value));
          }
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help`}
      >
        <option value="default">Inherited default · {readableDuration(inherited)}</option>
        {presets.map(seconds => (
          <option key={seconds} value={seconds}>
            {readableDuration(seconds)}
          </option>
        ))}
        <option value="custom">Custom duration</option>
      </select>
      {(custom || (value !== null && !presets.includes(value))) && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            Custom value
            <input
              aria-label={`${label} custom value`}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              type="number"
              step="any"
              min={min / unit}
              max={max / unit}
              value={value === null ? '' : value / unit}
              onChange={event =>
                onChange(event.target.value ? Math.round(Number(event.target.value) * unit) : 0)
              }
            />
          </label>
          <label className="text-xs text-muted-foreground">
            Unit
            <select
              aria-label={`${label} unit`}
              value={unit}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              onChange={event => setUnit(Number(event.target.value))}
            >
              <option value={60}>Minutes</option>
              <option value={3600}>Hours</option>
              <option value={86400}>Days</option>
            </select>
          </label>
        </div>
      )}
      <p
        id={`${id}-help`}
        className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {error ??
          `Allowed range: ${readableDuration(min)} to ${readableDuration(max)}. Inherited uses the deployment default reported by the server.`}
      </p>
    </fieldset>
  );
}
export default function AuthenticationSessionPolicyForm() {
  const { configuration, update, data, fieldErrors, pending } = useAuthenticationWorkspace();
  const inherited = data.inheritedSessionPolicy;
  const maximum = configuration.sessionMaxAgeSeconds ?? inherited?.maximumAgeSeconds;
  const conflict =
    configuration.sessionIdleTimeoutSeconds !== null &&
    maximum !== undefined &&
    configuration.sessionIdleTimeoutSeconds > maximum;
  return (
    <section
      className="space-y-4 border-y border-border py-5"
      aria-labelledby="auth-session-duration-title"
    >
      <div>
        <h3 id="auth-session-duration-title" className="font-semibold">
          OpsKnight session limits
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          These govern OpsKnight sessions. They do not configure Microsoft Entra Conditional Access
          or another provider’s sign-in frequency.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <DurationField
          disabled={pending}
          id="auth-field-sessionMaxAgeSeconds"
          label="Maximum session lifetime"
          value={configuration.sessionMaxAgeSeconds}
          inherited={inherited?.maximumAgeSeconds}
          presets={[3600, 28800, 43200, 86400, 604800]}
          min={900}
          max={2592000}
          onChange={value => update('sessionMaxAgeSeconds', value)}
          error={fieldErrors.sessionMaxAgeSeconds}
        />
        <DurationField
          disabled={pending}
          id="auth-field-sessionIdleTimeoutSeconds"
          label="Idle timeout"
          value={configuration.sessionIdleTimeoutSeconds}
          inherited={inherited?.idleTimeoutSeconds}
          presets={[900, 1800, 3600, 7200, 14400, 28800]}
          min={300}
          max={604800}
          onChange={value => update('sessionIdleTimeoutSeconds', value)}
          error={
            conflict
              ? 'Idle timeout exceeds the chosen maximum lifetime.'
              : fieldErrors.sessionIdleTimeoutSeconds
          }
        />
      </div>
      {conflict && (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>Shorten the idle timeout or increase maximum lifetime before staging.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => update('sessionIdleTimeoutSeconds', maximum!)}
          >
            Match idle timeout to maximum lifetime
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Currently effective on the active provider: maximum{' '}
        {readableDuration(data.effectiveSessionPolicy?.maximumAgeSeconds)}, idle{' '}
        {readableDuration(data.effectiveSessionPolicy?.idleTimeoutSeconds)}. Draft changes take
        effect only after staging, real-login testing and activation.
      </p>
    </section>
  );
}
