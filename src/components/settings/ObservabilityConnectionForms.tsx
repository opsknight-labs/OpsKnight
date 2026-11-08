'use client';

import { useActionState, useId, useState } from 'react';
import {
  deleteConnectionAction,
  saveConnectionAction,
  testConnectionAction,
  type ConnectionActionState,
} from '@/app/(app)/settings/intelligence/connections/actions';
import { Button } from '@/components/ui/shadcn/button';
import DeleteConfirmDialog from '@/components/ui/DeleteConfirmDialog';
import {
  CONNECTOR_BOUNDS,
  capabilitySummary,
  KIND_DEFAULT_BASE_URL,
  KIND_LABELS,
  OBSERVABILITY_KINDS,
  type ObservabilityConnectionView,
  type ObservabilityKind,
} from '@/lib/intelligence/connectors/contract';

const initial: ConnectionActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

function Status({ state }: { state: ConnectionActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.ok ? 'status' : 'alert'}
      className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}
    >
      {state.message}
    </p>
  );
}

function Field({
  name,
  label,
  help,
  type = 'text',
  defaultValue,
  disabled,
  required,
  placeholder,
  min,
  max,
}: {
  name: string;
  label: string;
  help?: string;
  type?: string;
  defaultValue?: string | number | null;
  disabled: boolean;
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        min={min}
        max={max}
        autoComplete={type === 'password' ? 'off' : undefined}
        className={fieldClass}
      />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function Check({
  name,
  label,
  help,
  defaultChecked,
  disabled,
  value,
}: {
  name: string;
  label: string;
  help?: string;
  defaultChecked: boolean;
  disabled: boolean;
  value?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        type="checkbox"
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-1 h-4 w-4"
      />
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {help && <span className="block text-xs font-normal text-muted-foreground">{help}</span>}
      </label>
    </div>
  );
}

/** Per-kind labels for the two credential parts; `null` hides the field. */
const CREDENTIAL_LABELS: Record<
  ObservabilityKind,
  { secret: string; secondary: string | null; help: string }
> = {
  PROMETHEUS: {
    secret: 'Bearer token or password (optional)',
    secondary: 'User name (basic auth only)',
    help: 'Use a read-only token.',
  },
  LOKI: {
    secret: 'Bearer token or password (optional)',
    secondary: 'User name or tenant ID (basic auth only)',
    help: 'Use a read-only token.',
  },
  TEMPO: {
    secret: 'Bearer token or password (optional)',
    secondary: 'User name (basic auth only)',
    help: 'Use a read-only token.',
  },
  GRAFANA: {
    secret: 'Service account token',
    secondary: null,
    help: 'A Viewer service account is enough.',
  },
  DATADOG: {
    secret: 'API key',
    secondary: 'Application key',
    help: 'Scope the application key to read-only (metrics, logs and APM read).',
  },
  ELASTIC: {
    secret: 'API key, or password with a user name',
    secondary: 'User name (basic auth only)',
    help: 'Grant read on the log indices only.',
  },
  CLOUDWATCH: {
    secret: 'Secret access key',
    secondary: 'Access key ID',
    help: 'An IAM user limited to cloudwatch:GetMetricData, cloudwatch:ListMetrics and logs:FilterLogEvents.',
  },
  SENTRY: {
    secret: 'Auth token',
    secondary: null,
    help: 'An internal integration token with event:read and project:read.',
  },
  GITHUB: {
    secret: 'Token (optional for public repositories)',
    secondary: null,
    help: 'A fine-grained token with read-only Contents and Pull requests.',
  },
  GITLAB: {
    secret: 'Access token',
    secondary: null,
    help: 'A personal, group or project token with read_api.',
  },
};

export function ConnectionForm({
  connection,
  teams,
  canManage,
}: {
  connection?: ObservabilityConnectionView;
  teams: ReadonlyArray<{ id: string; name: string }>;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(saveConnectionAction, initial);
  const [kind, setKind] = useState<ObservabilityKind>(connection?.kind ?? 'PROMETHEUS');
  const kindId = useId();
  const disabled = !canManage || pending;
  // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed union
  const labels = CREDENTIAL_LABELS[kind];
  const stored = connection?.hasCredential && connection.kind === kind;
  const keepHelp = 'A credential is stored. Leave blank to keep it; enter a new one to replace it.';
  // eslint-disable-next-line security/detect-object-injection -- kind is a member of the closed union
  const defaultBase = KIND_DEFAULT_BASE_URL[kind];
  return (
    <form
      action={action}
      className="space-y-4 py-4"
      aria-label={connection ? `Edit ${connection.name}` : 'Add a connection'}
    >
      {connection && <input type="hidden" name="id" value={connection.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="name"
          label="Name"
          defaultValue={connection?.name}
          disabled={disabled}
          required
        />
        <div className="space-y-1">
          <label htmlFor={kindId} className="text-sm font-medium">
            Type
          </label>
          <select
            id={kindId}
            name="kind"
            value={kind}
            onChange={event => setKind(event.target.value as ObservabilityKind)}
            disabled={disabled}
            className={fieldClass}
          >
            {OBSERVABILITY_KINDS.map(value => (
              <option key={value} value={value}>
                {/* eslint-disable-next-line security/detect-object-injection -- closed union */}
                {KIND_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Answers: {capabilitySummary(kind)}.</p>
        </div>
        {kind !== 'CLOUDWATCH' && (
          <Field
            name="baseUrl"
            label="Base URL"
            help={
              defaultBase
                ? `Leave blank for ${defaultBase}.`
                : kind === 'GITHUB' || kind === 'GITLAB'
                  ? 'The API address.'
                  : 'For example https://prometheus.example.com'
            }
            placeholder={defaultBase ?? 'https://'}
            defaultValue={connection?.baseUrl ?? ''}
            disabled={disabled}
            required={!defaultBase}
          />
        )}
        {kind === 'CLOUDWATCH' && (
          <Field
            name="region"
            label="AWS region"
            placeholder="us-east-1"
            defaultValue={connection?.region}
            disabled={disabled}
            required
          />
        )}
        {(kind === 'SENTRY' || kind === 'GRAFANA') && (
          <Field
            name="org"
            label={kind === 'SENTRY' ? 'Organization slug' : 'Organization ID (optional)'}
            defaultValue={connection?.org}
            disabled={disabled}
            required={kind === 'SENTRY'}
          />
        )}
        {(kind === 'SENTRY' ||
          kind === 'GRAFANA' ||
          kind === 'ELASTIC' ||
          kind === 'CLOUDWATCH') && (
          <Field
            name="project"
            label={
              kind === 'SENTRY'
                ? 'Project slug (optional)'
                : kind === 'GRAFANA'
                  ? 'Data source UID (Prometheus or Loki)'
                  : kind === 'ELASTIC'
                    ? 'Index pattern'
                    : 'Log group (for log search)'
            }
            placeholder={kind === 'ELASTIC' ? 'logs-*' : undefined}
            defaultValue={connection?.project}
            disabled={disabled}
            required={kind === 'GRAFANA'}
          />
        )}
        <Field
          name="secret"
          label={labels.secret}
          type="password"
          help={stored ? keepHelp : `${labels.help} Stored encrypted; never shown again.`}
          disabled={disabled}
        />
        {labels.secondary && (
          <Field
            name="secondary"
            label={labels.secondary}
            type={kind === 'DATADOG' ? 'password' : 'text'}
            help={stored ? 'Enter it again together with the secret to change it.' : undefined}
            disabled={disabled}
          />
        )}
        <Field
          name="timeoutMs"
          label="Timeout (ms)"
          type="number"
          min={CONNECTOR_BOUNDS.timeoutMs.min}
          max={CONNECTOR_BOUNDS.timeoutMs.max}
          defaultValue={connection?.timeoutMs ?? CONNECTOR_BOUNDS.timeoutMs.default}
          disabled={disabled}
          required
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Teams allowed to use it</legend>
        <p className="text-xs text-muted-foreground">
          None selected means everyone who can use the assistant. Administrators can always use
          enabled connections.
        </p>
        {teams.length === 0 ? (
          <p className="text-xs text-muted-foreground">No teams yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {teams.map(team => (
              <Check
                key={team.id}
                name="allowedTeamIds"
                value={team.id}
                label={team.name}
                defaultChecked={connection?.allowedTeamIds.includes(team.id) ?? false}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </fieldset>
      <Check
        name="enabled"
        label="Enabled"
        help="Squire can query an enabled connection during AI answers. Off by default."
        defaultChecked={connection?.enabled ?? false}
        disabled={disabled}
      />
      {kind !== 'CLOUDWATCH' && (
        <Check
          name="allowPrivateNetwork"
          label="Allow a private-network address"
          help="Explicit consent to reach an internal host. Only that exact address is ever contacted; cloud metadata addresses are always refused."
          defaultChecked={connection?.allowPrivateNetwork ?? false}
          disabled={disabled}
        />
      )}
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : connection ? 'Update connection' : 'Add connection'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function DeleteConnectionButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteConnectionAction, initial);
  return (
    <div className="inline-flex items-center gap-2">
      <DeleteConfirmDialog
        title={`Remove ${name}?`}
        description="Squire stops using this connection immediately and its stored credential is deleted."
        confirmText="Remove connection"
        disabled={pending}
        trigger={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            aria-label={`Remove ${name}`}
          >
            Remove
          </Button>
        }
        onConfirm={() => {
          const data = new FormData();
          data.set('id', id);
          action(data);
        }}
      />
      <Status state={state} />
    </div>
  );
}

export function TestConnectionButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(testConnectionAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label={`Test ${name}`}
      >
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      <Status state={state} />
    </form>
  );
}
