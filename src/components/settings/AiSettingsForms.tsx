'use client';

import { useActionState, useId } from 'react';
import {
  deleteAiProviderAction,
  saveAiProviderAction,
  saveAiSettingsAction,
  testAiProviderAction,
  type AiActionState,
} from '@/app/(app)/settings/intelligence/ai/actions';
import { Button } from '@/components/ui/shadcn/button';
import { AI_SETTINGS_BOUNDS } from '@/lib/intelligence/ai/contract';

const initial: AiActionState = { message: '', ok: false };
const fieldClass = 'w-full rounded-md border border-border bg-background p-2 text-sm';

function Status({ state }: { state: AiActionState }) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-emerald-600' : 'text-sm text-destructive'}>
      {state.message}
    </p>
  );
}

function Check({ name, label, help, defaultChecked, disabled }: { name: string; label: string; help?: string; defaultChecked: boolean; disabled: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} name={name} type="checkbox" defaultChecked={defaultChecked} disabled={disabled} className="mt-1 h-4 w-4" />
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {help && <span className="block text-xs font-normal text-muted-foreground">{help}</span>}
      </label>
    </div>
  );
}

function Field({ name, label, help, type = 'text', defaultValue, disabled, min, max, required, placeholder, autoComplete }: {
  name: string; label: string; help?: string; type?: string; defaultValue?: string | number; disabled: boolean; min?: number; max?: number; required?: boolean; placeholder?: string; autoComplete?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} name={name} type={type} defaultValue={defaultValue} disabled={disabled} min={min} max={max} required={required} placeholder={placeholder} autoComplete={autoComplete} className={fieldClass} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

type SettingsValues = {
  enabled: boolean;
  squireEnabled: boolean;
  squireName: string;
  allowExternalFallback: boolean;
  requestsPerMinutePerUser: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  revision: number;
};

export function AiSettingsForm({ settings, canManage }: { settings: SettingsValues; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveAiSettingsAction, initial);
  const b = AI_SETTINGS_BOUNDS;
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-4 py-4">
      <input type="hidden" name="expectedRevision" value={settings.revision} />
      <Check name="enabled" label="Enable AI" help="Lets the assistant use a language model from the providers below. Off by default; nothing leaves your environment while it is off." defaultChecked={settings.enabled} disabled={disabled} />
      <Check name="squireEnabled" label="Show the assistant" help="Shows the assistant button for signed-in users. It works without AI, using your incident data." defaultChecked={settings.squireEnabled} disabled={disabled} />
      <Field name="squireName" label="Assistant name" help="Shown in the button and the chat. Letters, numbers, spaces, apostrophes, dots and hyphens." defaultValue={settings.squireName} disabled={disabled} required />
      <Check name="allowExternalFallback" label="Allow fallback from self-hosted to external providers" help="Off keeps data on your own infrastructure when a self-hosted model is down; the assistant then answers without AI." defaultChecked={settings.allowExternalFallback} disabled={disabled} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="requestsPerMinutePerUser" label="Requests per minute, per user" type="number" min={b.requestsPerMinute.min} max={b.requestsPerMinute.max} defaultValue={settings.requestsPerMinutePerUser} disabled={disabled} required />
        <Field name="dailyTokenBudget" label="Daily token budget" help="Across all users, UTC day. At the limit the assistant switches to basic answers." type="number" min={b.dailyTokenBudget.min} max={b.dailyTokenBudget.max} defaultValue={settings.dailyTokenBudget} disabled={disabled} required />
        <Field name="maxOutputTokens" label="Maximum answer length (tokens)" type="number" min={b.maxOutputTokens.min} max={b.maxOutputTokens.max} defaultValue={settings.maxOutputTokens} disabled={disabled} required />
        <Field name="requestTimeoutMs" label="Request timeout (ms)" type="number" min={b.requestTimeoutMs.min} max={b.requestTimeoutMs.max} defaultValue={settings.requestTimeoutMs} disabled={disabled} required />
      </div>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export type ProviderValues = {
  id: string;
  name: string;
  kind: 'OPENAI' | 'ANTHROPIC' | 'GOOGLE' | 'OPENAI_COMPATIBLE';
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  isExternal: boolean;
  maxDataClass: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
  allowPrivateNetwork: boolean;
  priority: number;
  hasApiKey: boolean;
};

const KIND_LABEL: Record<ProviderValues['kind'], string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GOOGLE: 'Google Gemini',
  OPENAI_COMPATIBLE: 'OpenAI-compatible (Ollama, vLLM, LiteLLM, OmniRoute, Azure…)',
};

export function ProviderForm({ provider, canManage }: { provider?: ProviderValues; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveAiProviderAction, initial);
  const kindId = useId();
  const classId = useId();
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-4 py-4">
      {provider && <input type="hidden" name="id" value={provider.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" defaultValue={provider?.name} disabled={disabled} required />
        <div className="space-y-1">
          <label htmlFor={kindId} className="text-sm font-medium">Provider</label>
          <select id={kindId} name="kind" defaultValue={provider?.kind ?? 'OPENAI'} disabled={disabled} className={fieldClass}>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <Field name="model" label="Model" placeholder="for example gpt-4.1-mini" defaultValue={provider?.model} disabled={disabled} required />
        <Field name="baseUrl" label="Base URL" help="Required for OpenAI-compatible endpoints. Optional otherwise." defaultValue={provider?.baseUrl ?? ''} disabled={disabled} placeholder="https://" />
        <Field
          name="apiKey"
          label="API key"
          type="password"
          autoComplete="off"
          help={provider?.hasApiKey ? 'A key is stored. Leave blank to keep it; enter a new one to replace it.' : 'Stored encrypted. Never shown again.'}
          disabled={disabled}
        />
        <Field name="priority" label="Priority" help="Lower runs first. Later providers are fallbacks." type="number" min={0} max={10000} defaultValue={provider?.priority ?? 100} disabled={disabled} required />
        <div className="space-y-1">
          <label htmlFor={classId} className="text-sm font-medium">Most sensitive data it may receive</label>
          <select id={classId} name="maxDataClass" defaultValue={provider?.maxDataClass ?? 'INTERNAL'} disabled={disabled} className={fieldClass}>
            <option value="PUBLIC">Public</option>
            <option value="INTERNAL">Internal (incident titles and operational data)</option>
            <option value="PERSONAL">Personal data</option>
            <option value="SENSITIVE">Sensitive</option>
          </select>
        </div>
      </div>
      <Check name="enabled" label="Enabled" defaultChecked={provider?.enabled ?? true} disabled={disabled} />
      <Check name="isExternal" label="Data leaves our infrastructure" help="Leave on for hosted APIs. Turn off only for models you run yourself." defaultChecked={provider?.isExternal ?? true} disabled={disabled} />
      <Check name="allowPrivateNetwork" label="Allow a private-network address" help="Explicit consent to reach an internal host such as Ollama. Only that exact address is ever contacted." defaultChecked={provider?.allowPrivateNetwork ?? false} disabled={disabled} />
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : provider ? 'Update provider' : 'Add provider'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}

export function DeleteProviderButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(deleteAiProviderAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${name}`}>
        Remove
      </Button>
      <Status state={state} />
    </form>
  );
}

export function TestProviderButton({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState(testAiProviderAction, initial);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" disabled={pending} aria-label={`Test ${name}`}>
        {pending ? 'Testing…' : 'Test connection'}
      </Button>
      <Status state={state} />
    </form>
  );
}
