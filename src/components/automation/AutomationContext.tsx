'use client';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, Database, Plus, Search, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { cn } from '@/lib/utils';
import { CanonicalValuesEditor } from './CanonicalValuesEditor';
import {
  AuthoringFieldset,
  Hint,
  InlineError,
  LimitCounter,
  NativeSelect,
  textareaClass,
} from './authoring/primitives';
import { useStableCallback } from './authoring/hooks';
import {
  deriveFieldKey,
  FieldCatalogRow,
  FieldDetail,
  newFieldProblems,
} from './authoring/context-fields';

import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import { builtinFields, LIMITS, type Snapshot, type Field } from '@/lib/automation/contract';
import { formatHierarchicalLabel } from '@/lib/automation/discovery';

import type { Data, Discovery } from './presentation-types';
const EMPTY_SET = new Set<string>();
export function AutomationContext({
  data,
  draft,
  contextSearch,
  setContextSearch,
  updateField,
  setDeleteField,
  integrationType,
  setIntegrationType,
  observedPath,
  setObservedPath,
  discoveries,
  setDiscoveries,
  fieldLabel,
  setFieldLabel,
  fieldType,
  setFieldType,
  values,
  setValues,
  addField,
  advanced,
  setAdvanced,
  busy,
  setBusy,
  setError,
  serviceId,
  providerSample,
  setProviderSample,
  analyze,
}: {
  data: Data;
  draft: Snapshot;
  contextSearch: string;
  setContextSearch: (value: string) => void;
  updateField: (key: string, update: Partial<Field>) => void;
  setDeleteField: (field: Field) => void;
  integrationType: string;
  setIntegrationType: (value: string) => void;
  observedPath: string;
  setObservedPath: (value: string) => void;
  discoveries: Discovery[];
  setDiscoveries: (value: Discovery[]) => void;
  fieldLabel: string;
  setFieldLabel: (value: string) => void;
  fieldType: Field['type'];
  setFieldType: (value: Field['type']) => void;
  values: string[];
  setValues: (value: string[]) => void;
  addField: () => void;
  advanced: boolean;
  setAdvanced: (value: boolean) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  serviceId: string;
  providerSample: string;
  setProviderSample: (value: string) => void;
  analyze: () => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const formId = useId();
  const visibleFields = useMemo(
    () =>
      draft.fields.filter(field =>
        `${field.label} ${field.key}`.toLowerCase().includes(contextSearch.toLowerCase())
      ),
    [draft.fields, contextSearch]
  );
  const selected = visibleFields.find(field => field.key === selectedKey) ?? visibleFields[0];
  const stableUpdateField = useStableCallback(updateField);
  const stableDeleteField = useStableCallback(setDeleteField);
  const canReadSensitive = data.canReadSensitive !== false;

  const observedOptions = useMemo(() => {
    const list: Array<{
      id: string;
      path: string;
      key: string;
      label: string;
      integrationType?: string;
      source: 'PROVIDER' | 'EVENT';
      type?: string;
    }> = [];
    const seen = new Set<string>();

    for (const o of data.observations) {
      if (integrationType !== 'ALL' && o.integrationType !== integrationType) continue;
      const compositeId = `${o.integrationType}:PROVIDER:${o.sourcePath}`;
      if (seen.has(compositeId)) continue;
      seen.add(compositeId);
      list.push({
        id: compositeId,
        path: o.sourcePath,
        key: o.fieldKey,
        label: formatHierarchicalLabel(o.sourcePath),
        integrationType: o.integrationType,
        source: 'PROVIDER',
        type: o.fieldType,
      });
    }

    for (const d of discoveries) {
      if (integrationType !== 'ALL' && d.integrationType && d.integrationType !== integrationType)
        continue;
      const source = d.source ?? 'PROVIDER';
      const compositeId = `${d.integrationType ?? 'ALL'}:${source}:${d.path}`;
      if (seen.has(compositeId)) continue;
      seen.add(compositeId);
      list.push({
        id: compositeId,
        path: d.path,
        key: d.key,
        label: d.label ?? formatHierarchicalLabel(d.path),
        integrationType: d.integrationType,
        source,
        type: d.type,
      });
    }
    return list;
  }, [data.observations, discoveries, integrationType]);

  const integrationTypes = useMemo(
    () => [...new Set(data.integrations.map(i => i.type))],
    [data.integrations]
  );
  const existingKeys = useMemo(
    () => new Set([...builtinFields, ...draft.fields].map(field => field.key)),
    [draft.fields]
  );
  const newKey = deriveFieldKey(fieldLabel);
  const problems = newFieldProblems({
    label: fieldLabel,
    key: newKey,
    existingKeys,
    observedPath,
    fieldCount: draft.fields.length,
    type: fieldType,
    values,
  });
  const problemSummary = [problems.limit, problems.label, problems.source, problems.values]
    .filter(Boolean)
    .join(' ');

  const discoverRecent = () => {
    void (async () => {
      setBusy(true);
      try {
        const response = await automationAction({
          action: 'discoverRecent',
          serviceId,
        });
        if (!response.ok) setError(response.error);
        else {
          const raw = response.data as Discovery[];
          const enriched = raw.map(field => ({
            ...field,
            label: field.label ?? formatHierarchicalLabel(field.path),
            source: 'EVENT' as const,
          }));
          setDiscoveries(enriched);
          if (!enriched.length)
            setError('No suitable fields in recent alerts. Use a provider sample to get started.');
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Define canonical context from fields observed in your integrations. Unmapped choices never
          satisfy negative conditions.
        </p>
        <LimitCounter count={draft.fields.length} limit={LIMITS.fields} noun="fields" />
      </div>
      <div
        className={cn(
          'grid min-w-0 gap-4',
          data.canEdit && 'xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]'
        )}
      >
        <div className="min-w-0 space-y-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label="Search context fields"
              placeholder="Search context fields…"
              value={contextSearch}
              onChange={event => setContextSearch(event.target.value)}
              className="pl-9"
            />
          </div>
          {draft.fields.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
              <Database className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium">No context fields yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {data.canEdit
                  ? 'Add a field from an observed integration value below, or discover fields from recent alerts or a sample payload.'
                  : 'An editor can add context fields from observed integration values.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              <div
                aria-hidden="true"
                className="hidden gap-x-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1fr)_minmax(0,1.2fr)]"
              >
                <span>Field</span>
                <span>Type</span>
                <span>Mappings &amp; values</span>
                <span>Source</span>
              </div>
              <ul aria-label="Context field catalog" className="divide-y divide-border/70">
                {visibleFields.map(field => (
                  <FieldCatalogRow
                    key={field.key}
                    field={field}
                    selected={selected?.key === field.key}
                    onSelect={setSelectedKey}
                  />
                ))}
              </ul>
              {!visibleFields.length && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No matching context fields.
                </p>
              )}
            </div>
          )}
          {selected && (
            <FieldDetail
              key={selected.key}
              field={selected}
              rules={draft.rules}
              observations={data.observations}
              canEdit={data.canEdit}
              canReadSensitive={canReadSensitive}
              updateField={stableUpdateField}
              onRemove={stableDeleteField}
            />
          )}
          {data.canEdit && (
            <section
              aria-labelledby={`${formId}-title`}
              className="space-y-4 rounded-lg border bg-card p-4"
            >
              <div>
                <h3 id={`${formId}-title`} className="font-semibold tracking-tight">
                  Add context field
                </h3>
                <p className="text-xs text-muted-foreground">
                  Pick where the value comes from, name it, then (for choices) list the canonical
                  values rules will compare against.
                </p>
              </div>
              <AuthoringFieldset legend="1. Source">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-integration`}>Integration</Label>
                    <NativeSelect
                      id={`${formId}-integration`}
                      value={integrationType}
                      onChange={e => setIntegrationType(e.target.value)}
                    >
                      <option>EVENTS_API</option>
                      <option value="ALL">All providers</option>
                      {integrationTypes.map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-observed`}>Observed field</Label>
                    <NativeSelect
                      id={`${formId}-observed`}
                      value={observedPath}
                      aria-invalid={!!problems.source || undefined}
                      aria-describedby={problems.source ? `${formId}-source-error` : undefined}
                      onChange={e => {
                        const path = e.target.value;
                        setObservedPath(path);
                        const found = observedOptions.find(o => o.path === path);
                        if (found) {
                          setFieldLabel(found.label);
                          if (found.integrationType && found.integrationType !== 'ALL') {
                            setIntegrationType(found.integrationType);
                          }
                          if (found.type === 'NUMBER' || found.type === 'BOOLEAN') {
                            setFieldType(found.type);
                          }
                        }
                      }}
                    >
                      <option value="">Choose field…</option>
                      {observedPath && !observedOptions.some(o => o.path === observedPath) && (
                        <option value={observedPath}>{observedPath}</option>
                      )}
                      {observedOptions.map(option => (
                        <option key={option.id} value={option.path}>
                          {option.label} — {option.path}{option.integrationType ? ` (${option.integrationType})` : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                {observedOptions.length === 0 && (
                  <Hint>
                    No observed fields for this integration yet. Use discovery to find fields, or
                    enter a path under Advanced mapping.
                  </Hint>
                )}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 px-2 sm:h-9"
                    aria-expanded={advanced}
                    aria-controls={advanced ? `${formId}-advanced` : undefined}
                    onClick={() => setAdvanced(!advanced)}
                  >
                    <ChevronDown
                      className={cn('transition-transform', advanced && 'rotate-180')}
                      aria-hidden="true"
                    />
                    Advanced mapping
                  </Button>
                  {advanced && (
                    <div id={`${formId}-advanced`} className="mt-2 space-y-1.5">
                      <Label htmlFor={`${formId}-path`}>Source path</Label>
                      <Input
                        id={`${formId}-path`}
                        className="font-mono"
                        placeholder="payload.custom_details.environment"
                        value={observedPath}
                        onChange={e => setObservedPath(e.target.value)}
                      />
                      <Hint>Dot-separated path into the event or provider payload.</Hint>
                    </div>
                  )}
                </div>
                {problems.source && (
                  <InlineError id={`${formId}-source-error`}>{problems.source}</InlineError>
                )}
              </AuthoringFieldset>
              <AuthoringFieldset legend="2. Name and type">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-label`}>Field label</Label>
                    <Input
                      id={`${formId}-label`}
                      maxLength={100}
                      aria-invalid={!!problems.label || undefined}
                      aria-describedby={`${formId}-label-note`}
                      value={fieldLabel}
                      onChange={e => setFieldLabel(e.target.value)}
                    />
                    <div id={`${formId}-label-note`}>
                      {problems.label ? (
                        <InlineError>{problems.label}</InlineError>
                      ) : (
                        newKey && (
                          <Hint>
                            Key: <code className="font-mono">automation.{newKey}</code>
                          </Hint>
                        )
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${formId}-type`}>Treat as</Label>
                    <NativeSelect
                      id={`${formId}-type`}
                      value={fieldType}
                      onChange={e => setFieldType(e.target.value as Field['type'])}
                    >
                      <option value="STRING">Text</option>
                      <option value="ENUM">Choice</option>
                      <option value="NUMBER">Number</option>
                      <option value="BOOLEAN">True / False</option>
                    </NativeSelect>
                    <Hint>
                      {fieldType === 'ENUM'
                        ? 'Values are normalized to a fixed list of choices.'
                        : fieldType === 'NUMBER'
                          ? 'Enables less-than / greater-than comparisons.'
                          : fieldType === 'BOOLEAN'
                            ? 'Only true and false are recognized.'
                            : 'Free text, compared case-insensitively by default.'}
                    </Hint>
                  </div>
                </div>
              </AuthoringFieldset>
              {fieldType === 'ENUM' && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold tracking-tight">3. Canonical values</p>
                  <CanonicalValuesEditor
                    values={values}
                    usedValues={EMPTY_SET}
                    onChange={setValues}
                  />
                  {problems.values && <InlineError>{problems.values}</InlineError>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  disabled={
                    draft.fields.length >= LIMITS.fields ||
                    !fieldLabel.trim() ||
                    (fieldType === 'ENUM' && !values.length)
                  }
                  onClick={addField}
                >
                  <Plus aria-hidden="true" />
                  Add field
                </Button>
                {problems.limit && <InlineError>{problems.limit}</InlineError>}
              </div>
              <p aria-live="polite" className="sr-only">
                {problemSummary}
              </p>
            </section>
          )}
        </div>
        {data.canEdit && (
          <aside
            aria-labelledby={`${formId}-discover`}
            className="min-w-0 space-y-4 self-start rounded-lg border bg-card p-4"
          >
            <div>
              <h3
                id={`${formId}-discover`}
                className="flex items-center gap-2 font-semibold tracking-tight"
              >
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                Discover fields from recent alerts or a sample
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Suggestions fill the Add context field form. Nothing is saved until you add the
                field.
              </p>
            </div>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="h-10 w-full sm:h-9"
                disabled={busy || !canReadSensitive}
                onClick={discoverRecent}
              >
                Discover from recent alerts
              </Button>
              {!canReadSensitive && (
                <Hint>
                  Recent alert discovery requires sensitive incident access. Paste a sample instead.
                </Hint>
              )}
            </div>
            {discoveries.length > 0 && (
              <ul aria-label="Discovered context fields" className="space-y-2">
                {discoveries.map(field => {
                  const hierarchical = field.label ?? formatHierarchicalLabel(field.path);
                  const chosen = observedPath === field.path;
                  return (
                    <li
                      key={`${field.integrationType ?? 'ALL'}:${field.source ?? 'PROVIDER'}:${field.path}`}
                      className={cn(
                        'space-y-1 rounded-md border p-3 text-sm',
                        chosen ? 'border-primary/50 bg-primary/5' : 'border-border/70'
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{hierarchical}</span>
                        <Button
                          size="sm"
                          variant={chosen ? 'secondary' : 'outline'}
                          aria-pressed={chosen}
                          className="h-10 sm:h-9"
                          onClick={() => {
                            setObservedPath(field.path);
                            setFieldLabel(hierarchical);
                            setFieldType(
                              field.type === 'NUMBER' || field.type === 'BOOLEAN'
                                ? field.type
                                : 'STRING'
                            );
                            if (field.integrationType && field.integrationType !== 'ALL') {
                              setIntegrationType(field.integrationType);
                            }
                          }}
                        >
                          Choose field
                        </Button>
                      </div>
                      <p className="break-all font-mono text-xs text-muted-foreground">
                        {field.path} · {field.type}
                        {field.integrationType ? ` · ${field.integrationType}` : ''}
                        {field.source ? ` · ${field.source}` : ''}
                        {field.frequency ? ` · ${field.frequency} recent alerts` : ''}
                      </p>
                      <p className="break-words text-xs">
                        Examples: {(field.examples ?? [field.value]).join(', ')}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="space-y-1.5 border-t border-border/70 pt-4">
              <Label htmlFor={`${formId}-sample`}>Discovery sample</Label>
              <textarea
                id={`${formId}-sample`}
                className={cn(textareaClass, 'min-h-32')}
                spellCheck={false}
                value={providerSample}
                onChange={e => setProviderSample(e.target.value)}
              />
              <Hint>
                Paste raw JSON from your provider. Secret-like values are never suggested.
              </Hint>
              <Button
                size="sm"
                variant="outline"
                className="h-10 sm:h-9"
                onClick={() => void analyze()}
              >
                Analyze sample
              </Button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
