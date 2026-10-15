'use client';
import { useState } from 'react';
import { Clock, AlertTriangle, Info, Timer } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Badge } from '@/components/ui/shadcn/badge';
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

  const isCustomActive = custom || (value !== null && !presets.includes(value));
  const isDefaultActive = !isCustomActive && value === null;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3 rounded-xl border border-border/80 bg-muted/20 p-4 transition-all hover:border-border">
      <div className="flex items-center justify-between gap-2">
        <legend className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Timer className="h-4 w-4 text-primary" />
          <span>{label}</span>
        </legend>
        <Badge variant={isDefaultActive ? 'neutral' : 'outline'} className="text-[10px] font-medium py-0">
          {isDefaultActive ? 'Inherited Default' : isCustomActive ? 'Custom Value' : 'Preset'}
        </Badge>
      </div>

      <label className="sr-only" htmlFor={id}>
        {label}
      </label>

      <select
        id={id}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      {isCustomActive && (
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <label className="text-xs font-medium text-muted-foreground space-y-1 block">
            <span>Custom value</span>
            <input
              aria-label={`${label} custom value`}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <label className="text-xs font-medium text-muted-foreground space-y-1 block">
            <span>Unit</span>
            <select
              aria-label={`${label} unit`}
              value={unit}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-2xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        className={`text-xs leading-relaxed ${error ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
      >
        {error ??
          `Allowed range: ${readableDuration(min)} to ${readableDuration(max)}. Inherited uses the deployment default reported by the server.`}
      </p>
    </fieldset>
  );
}

export default function AuthenticationSessionPolicyForm() {
  const { configuration, update, data, fieldErrors, pending, draftGeneration } =
    useAuthenticationWorkspace();
  const inherited = data.inheritedSessionPolicy;
  const maximum = configuration.sessionMaxAgeSeconds ?? inherited?.maximumAgeSeconds;
  const conflict =
    configuration.sessionIdleTimeoutSeconds !== null &&
    maximum !== undefined &&
    configuration.sessionIdleTimeoutSeconds > maximum;

  return (
    <section
      className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 shadow-xs"
      aria-labelledby="auth-session-duration-title"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h3 id="auth-session-duration-title" className="text-base font-semibold text-foreground">
            OpsKnight session limits
          </h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            These govern OpsKnight sessions. They do not configure Microsoft Entra Conditional Access
            or another provider’s sign-in frequency.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 pt-2">
        <DurationField
          key={`maximum-${draftGeneration}`}
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
          key={`idle-${draftGeneration}`}
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
        <div
          role="alert"
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 text-destructive"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-xs font-semibold">
              Shorten the idle timeout or increase maximum lifetime before staging.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/30 hover:bg-destructive/15 text-destructive shrink-0"
            onClick={() => update('sessionIdleTimeoutSeconds', maximum!)}
          >
            Match idle timeout to maximum lifetime
          </Button>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          Currently effective on the active provider: maximum{' '}
          <span className="font-semibold text-foreground">
            {readableDuration(data.effectiveSessionPolicy?.maximumAgeSeconds)}
          </span>
          , idle{' '}
          <span className="font-semibold text-foreground">
            {readableDuration(data.effectiveSessionPolicy?.idleTimeoutSeconds)}
          </span>
          . Draft changes take effect only after staging, real-login testing and activation.
        </p>
      </div>
    </section>
  );
}
