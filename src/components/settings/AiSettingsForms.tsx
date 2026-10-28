'use client';

import { useActionState, useId, useState } from 'react';
import {
  deleteAiProviderAction,
  saveAiProviderAction,
  saveAiSettingsAction,
  savePromptGuidanceAction,
  testAiProviderAction,
  type AiActionState,
} from '@/app/(app)/settings/intelligence/ai/actions';
import { Button } from '@/components/ui/shadcn/button';
import { AI_SETTINGS_BOUNDS, type SquireAvatar, type SquireLauncherStyle } from '@/lib/intelligence/ai/contract';
import SquireAvatarIcon from '@/components/squire/SquireAvatar';

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

const AVATARS: ReadonlyArray<readonly [SquireAvatar, string]> = [
  ['ICON', 'Simple icon'],
  ['KNIGHT', 'Knight'],
  ['OWL', 'Owl'],
  ['ROBOT', 'Robot'],
];

function SelectField({ name, label, defaultValue, disabled, options }: {
  name: string; label: string; defaultValue: string; disabled: boolean; options: ReadonlyArray<readonly [string, string]>;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select id={id} name={name} defaultValue={defaultValue} disabled={disabled} className={fieldClass}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

type SettingsValues = {
  enabled: boolean;
  squireEnabled: boolean;
  squireName: string;
  squireAvatar: SquireAvatar;
  squireLauncher: SquireLauncherStyle;
  squireAnimations: boolean;
  allowExternalFallback: boolean;
  requestsPerMinutePerUser: number;
  dailyTokenBudget: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  allowedDataRegions: string[];
  embeddingsEnabled: boolean;
  squireHistoryEnabled: boolean;
  squireHistoryRetentionDays: number;
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
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="text-sm font-medium">Look</legend>
        <div className="flex flex-wrap gap-2">
          {AVATARS.map(([kind, label]) => (
            <label key={kind} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input type="radio" name="squireAvatar" value={kind} defaultChecked={settings.squireAvatar === kind} className="h-4 w-4" />
              <SquireAvatarIcon kind={kind} size="md" />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <SelectField
        name="squireLauncher"
        label="Where people find it"
        defaultValue={settings.squireLauncher}
        disabled={disabled}
        options={[
          ['FLOATING', 'Floating button in the corner, plus global search'],
          ['SEARCH_ONLY', 'Global search and incident pages only (no floating button)'],
        ]}
      />
      <Check name="squireAnimations" label="Gentle animation" help="A small idle motion on the mascot. Always off for people whose system asks for reduced motion." defaultChecked={settings.squireAnimations} disabled={disabled} />
      <Check name="allowExternalFallback" label="Allow fallback from self-hosted to external providers" help="Off keeps data on your own infrastructure when a self-hosted model is down; the assistant then answers without AI." defaultChecked={settings.allowExternalFallback} disabled={disabled} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="requestsPerMinutePerUser" label="Requests per minute, per user" type="number" min={b.requestsPerMinute.min} max={b.requestsPerMinute.max} defaultValue={settings.requestsPerMinutePerUser} disabled={disabled} required />
        <Field name="dailyTokenBudget" label="Daily token budget" help="Across all users, UTC day. At the limit the assistant switches to basic answers." type="number" min={b.dailyTokenBudget.min} max={b.dailyTokenBudget.max} defaultValue={settings.dailyTokenBudget} disabled={disabled} required />
        <Field name="maxOutputTokens" label="Maximum answer length (tokens)" type="number" min={b.maxOutputTokens.min} max={b.maxOutputTokens.max} defaultValue={settings.maxOutputTokens} disabled={disabled} required />
        <Field name="requestTimeoutMs" label="Request timeout (ms)" type="number" min={b.requestTimeoutMs.min} max={b.requestTimeoutMs.max} defaultValue={settings.requestTimeoutMs} disabled={disabled} required />
      </div>
      <Field
        name="allowedDataRegions"
        label="Allowed data regions (optional)"
        help="Comma-separated, for example eu, eu-west. When set, only providers tagged with one of these regions are used. Leave blank to allow any."
        defaultValue={settings.allowedDataRegions.join(', ')}
        disabled={disabled}
      />
      <Check
        name="embeddingsEnabled"
        label="Semantic search for similar incidents"
        help="Sends masked incident titles (numbers and identifiers removed) to a provider with an embedding model, to find similar incidents by meaning, not just wording. Vectors follow fingerprint retention."
        defaultChecked={settings.embeddingsEnabled}
        disabled={disabled}
      />
      <Check
        name="squireHistoryEnabled"
        label="Let people save assistant conversations"
        help="Off by default. Conversations are encrypted, visible only to the person who had them, and deleted after the retention period."
        defaultChecked={settings.squireHistoryEnabled}
        disabled={disabled}
      />
      <Field name="squireHistoryRetentionDays" label="Keep saved conversations for (days)" type="number" min={1} max={365} defaultValue={settings.squireHistoryRetentionDays} disabled={disabled} required />
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

export type ProviderKind =
  | 'OPENAI'
  | 'ANTHROPIC'
  | 'GOOGLE'
  | 'OPENAI_COMPATIBLE'
  | 'AZURE_OPENAI'
  | 'BEDROCK'
  | 'VERTEX'
  | 'MISTRAL'
  | 'GROQ';

export type ProviderValues = {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string | null;
  enabled: boolean;
  isExternal: boolean;
  maxDataClass: 'PUBLIC' | 'INTERNAL' | 'PERSONAL' | 'SENSITIVE';
  allowPrivateNetwork: boolean;
  priority: number;
  dataRegion: string | null;
  embeddingModel: string | null;
  options: { azureResourceName?: string; azureApiVersion?: string; awsRegion?: string; gcpProject?: string; gcpLocation?: string };
  hasApiKey: boolean;
};

const KINDS: ReadonlyArray<readonly [ProviderKind, string]> = [
  ['OPENAI', 'OpenAI'],
  ['ANTHROPIC', 'Anthropic'],
  ['GOOGLE', 'Google Gemini'],
  ['AZURE_OPENAI', 'Azure OpenAI'],
  ['BEDROCK', 'Amazon Bedrock'],
  ['VERTEX', 'Google Vertex AI'],
  ['MISTRAL', 'Mistral'],
  ['GROQ', 'Groq'],
  ['OPENAI_COMPATIBLE', 'OpenAI-compatible (Ollama, vLLM, LiteLLM, OmniRoute…)'],
];

const MODEL_HINT: ReadonlyArray<readonly [ProviderKind, string]> = [
  ['AZURE_OPENAI', 'The deployment name in your Azure resource'],
  ['BEDROCK', 'A Bedrock model ID, for example anthropic.claude-3-5-sonnet-20241022-v2:0'],
  ['VERTEX', 'A Vertex model ID, for example gemini-2.0-flash'],
];

const NO_EMBEDDINGS: ReadonlySet<ProviderKind> = new Set(['ANTHROPIC', 'GROQ']);

export function ProviderForm({ provider, canManage }: { provider?: ProviderValues; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveAiProviderAction, initial);
  const [kind, setKind] = useState<ProviderKind>(provider?.kind ?? 'OPENAI');
  const kindId = useId();
  const classId = useId();
  const saJsonId = useId();
  const disabled = !canManage || pending;
  const storedNote = provider?.hasApiKey && provider.kind === kind;
  const keepHelp = 'A credential is stored. Leave blank to keep it; enter a new one to replace it.';
  const modelHint = MODEL_HINT.find(([k]) => k === kind)?.[1];
  return (
    <form action={action} className="space-y-4 py-4">
      {provider && <input type="hidden" name="id" value={provider.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" defaultValue={provider?.name} disabled={disabled} required />
        <div className="space-y-1">
          <label htmlFor={kindId} className="text-sm font-medium">Provider</label>
          <select id={kindId} name="kind" value={kind} onChange={event => setKind(event.target.value as ProviderKind)} disabled={disabled} className={fieldClass}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <Field name="model" label={kind === 'AZURE_OPENAI' ? 'Deployment' : 'Model'} help={modelHint} placeholder="for example gpt-4.1-mini" defaultValue={provider?.model} disabled={disabled} required />
        {kind === 'AZURE_OPENAI' && (
          <>
            <Field name="azureResourceName" label="Azure resource name" help="The part before .openai.azure.com. Or set a base URL instead." defaultValue={provider?.options.azureResourceName} disabled={disabled} />
            <Field name="azureApiVersion" label="API version (optional)" placeholder="2024-10-21" defaultValue={provider?.options.azureApiVersion} disabled={disabled} />
          </>
        )}
        {kind === 'BEDROCK' && (
          <>
            <Field name="awsRegion" label="AWS region" placeholder="us-east-1" defaultValue={provider?.options.awsRegion} disabled={disabled} required />
            <Field name="awsAccessKeyId" label="Access key ID" autoComplete="off" help={storedNote ? keepHelp : 'Use a dedicated IAM user limited to bedrock:InvokeModel.'} disabled={disabled} />
            <Field name="awsSecretAccessKey" label="Secret access key" type="password" autoComplete="off" disabled={disabled} />
          </>
        )}
        {kind === 'VERTEX' && (
          <>
            <Field name="gcpProject" label="Google Cloud project ID" defaultValue={provider?.options.gcpProject} disabled={disabled} required />
            <Field name="gcpLocation" label="Location" placeholder="us-central1" defaultValue={provider?.options.gcpLocation} disabled={disabled} required />
            <div className="space-y-1 sm:col-span-2">
              <label htmlFor={saJsonId} className="text-sm font-medium">Service account key (JSON)</label>
              <textarea id={saJsonId} name="serviceAccountJson" rows={3} autoComplete="off" spellCheck={false} disabled={disabled} className={`${fieldClass} font-mono text-xs`} />
              <p className="text-xs text-muted-foreground">
                {storedNote ? keepHelp : 'Stored encrypted; only the account email and private key are kept. Grant it the Vertex AI User role only.'}
              </p>
            </div>
          </>
        )}
        {kind !== 'VERTEX' && (
          <Field
            name="baseUrl"
            label="Base URL"
            help={kind === 'OPENAI_COMPATIBLE' ? 'Required for OpenAI-compatible endpoints.' : 'Optional. Leave blank to use the provider\'s standard endpoint.'}
            defaultValue={provider?.baseUrl ?? ''}
            disabled={disabled}
            placeholder="https://"
          />
        )}
        {kind !== 'VERTEX' && (
          <Field
            name="apiKey"
            label={kind === 'BEDROCK' ? 'Bedrock API key (instead of access keys)' : 'API key'}
            type="password"
            autoComplete="off"
            help={storedNote ? keepHelp : 'Stored encrypted. Never shown again.'}
            disabled={disabled}
          />
        )}
        <Field name="priority" label="Priority" help="Lower runs first. Later providers are fallbacks." type="number" min={0} max={10000} defaultValue={provider?.priority ?? 100} disabled={disabled} required />
        <div className="space-y-1">
          <label htmlFor={classId} className="text-sm font-medium">Most sensitive data it may receive</label>
          <select id={classId} name="maxDataClass" defaultValue={provider?.maxDataClass ?? 'INTERNAL'} disabled={disabled} className={fieldClass}>
            <option value="PUBLIC">Public</option>
            <option value="INTERNAL">Internal (incident titles and operational data)</option>
            <option value="PERSONAL">Personal (notes and timelines, used for summaries and postmortem drafts)</option>
            <option value="SENSITIVE">Sensitive</option>
          </select>
        </div>
        <Field name="dataRegion" label="Data region tag (optional)" help="For example eu or us. Used when Settings limit AI to certain regions." defaultValue={provider?.dataRegion ?? ''} disabled={disabled} />
        {!NO_EMBEDDINGS.has(kind) && (
          <Field name="embeddingModel" label="Embedding model (optional)" help="Set this to let the provider power semantic search, for example text-embedding-3-small." defaultValue={provider?.embeddingModel ?? ''} disabled={disabled} />
        )}
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

export function PromptGuidanceForm({
  promptId,
  text,
  revision,
  canManage,
}: {
  promptId: string;
  text: string;
  revision: number;
  canManage: boolean;
}) {
  const [state, action, pending] = useActionState(savePromptGuidanceAction, initial);
  const id = useId();
  const disabled = !canManage || pending;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="promptId" value={promptId} />
      <input type="hidden" name="expectedRevision" value={revision} />
      <label htmlFor={id} className="text-sm font-medium">
        Organisation guidance (optional)
      </label>
      <textarea
        id={id}
        name="guidance"
        rows={3}
        maxLength={2000}
        defaultValue={text}
        disabled={disabled}
        placeholder="For example: our services are named after birds; use UTC times; link runbooks by name."
        className={fieldClass}
      />
      <p className="text-xs text-muted-foreground">
        Added after the built-in rules, which always take priority. Guidance cannot widen what the assistant may read or do.
      </p>
      <div className="flex items-center gap-3">
        {canManage && (
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save guidance'}
          </Button>
        )}
        <Status state={state} />
      </div>
    </form>
  );
}
