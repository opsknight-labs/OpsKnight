'use client';
import { useId, useMemo, useState } from 'react';
import { ChevronDown, Database, Plus, RotateCcw, Search, Sparkles } from 'lucide-react';
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
  deriveUniqueFieldKey,
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
  selectedSource,
  setSelectedSource,
  selectedIntegrationType,
  setSelectedIntegrationType,
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
  handleIntegrationTypeChange,
  selectObservedField,
}: {
  data: Data;
  draft: Snapshot;
  contextSearch: string;
  setContextSearch: (value: string) => void;
  updateField: (key: string, update: Partial<Field>) => void;
  setDeleteField: (field: Field) => void;
  integrationType: string;
  setIntegrationType: (value: string) => void;
  handleIntegrationTypeChange?: (value: string) => void;
  selectObservedField?: (
    field: {
      path: string;
      source?: 'PROVIDER' | 'EVENT';
      integrationType?: string;
      label?: string;
      type?: Field['type'];
    } | null
  ) => void;
  observedPath: string;
  setObservedPath: (value: string) => void;
  selectedSource?: 'PROVIDER' | 'EVENT';
  setSelectedSource?: (value: 'PROVIDER' | 'EVENT' | undefined) => void;
  selectedIntegrationType?: string;
  setSelectedIntegrationType?: (value: string | undefined) => void;
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
  const [internalSource, setInternalSource] = useState<'PROVIDER' | 'EVENT' | undefined>(undefined);
  const [internalIntType, setInternalIntType] = useState<string | undefined>(undefined);
  const effectiveIntType = selectedIntegrationType ?? internalIntType;
  const setIntType = setSelectedIntegrationType ?? setInternalIntType;
  const selectedDiscovery = discoveries.find(
    d =>
      d.path === observedPath &&
      (!selectedSource || d.source === selectedSource) &&
      (effectiveIntType && effectiveIntType !== 'ALL' && effectiveIntType !== 'EVENTS_API'
        ? d.integrationType === effectiveIntType ||
          (d.integrationType === undefined && selectedSource === 'EVENT')
        : (!effectiveIntType || effectiveIntType === 'ALL' || effectiveIntType === 'EVENTS_API') &&
          (!d.integrationType || d.integrationType === 'ALL' || d.integrationType === 'EVENTS_API'))
  );
  const effectiveSource: 'PROVIDER' | 'EVENT' =
    selectedSource ??
    internalSource ??
    selectedDiscovery?.source ??
    (effectiveIntType === 'EVENTS_API' || integrationType === 'EVENTS_API' ? 'EVENT' : 'PROVIDER');
  const setSource = setSelectedSource ?? setInternalSource;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const formId = useId();
  const visibleFields = useMemo(
    () =>
      draft.fields.filter(field =>
        `${field.label} ${field.key}`.toLowerCase().includes(contextSearch.toLowerCase())
      ),
    [draft.fields, contextSearch]
  );
  const ruleCountsByFieldKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const field of draft.fields) {
      let count = 0;
      for (const rule of draft.rules) {
        const conditionMatch = rule.conditions.some(c => c.fieldKey === field.key);
        const actionMatch = rule.actions.some(
          a => 'fieldKey' in a && (a as { fieldKey?: string }).fieldKey === field.key
        );
        if (conditionMatch || actionMatch) {
          count++;
        }
      }
      map.set(field.key, count);
    }
    return map;
  }, [draft.fields, draft.rules]);
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
      const recordedSource: 'PROVIDER' | 'EVENT' | undefined =
        o.source === 'PROVIDER' || o.source === 'EVENT'
          ? (o.source as 'PROVIDER' | 'EVENT')
          : undefined;
      const matchingDisc = discoveries.find(
        d =>
          d.path === o.sourcePath &&
          (o.integrationType === 'EVENTS_API'
            ? !d.integrationType ||
              d.integrationType === 'EVENTS_API' ||
              d.integrationType === 'ALL'
            : d.integrationType === o.integrationType || d.integrationType === 'ALL')
      );
      const source: 'PROVIDER' | 'EVENT' =
        recordedSource ??
        matchingDisc?.source ??
        (o.integrationType === 'EVENTS_API' ? 'EVENT' : 'PROVIDER');
      const compositeId = `${o.integrationType}:${source}:${o.sourcePath}`;
      if (seen.has(compositeId)) continue;
      seen.add(compositeId);
      list.push({
        id: compositeId,
        path: o.sourcePath,
        key: o.fieldKey,
        label: formatHierarchicalLabel(o.sourcePath),
        integrationType: o.integrationType,
        source,
        type: o.fieldType,
      });
    }

    for (const d of discoveries) {
      if (integrationType !== 'ALL' && d.integrationType && d.integrationType !== integrationType)
        continue;
      const source = d.source ?? (d.integrationType === 'EVENTS_API' ? 'EVENT' : 'PROVIDER');
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
  const newKey = deriveUniqueFieldKey(fieldLabel, existingKeys);
  const problems = newFieldProblems({
    label: fieldLabel,
    key: newKey,
    existingKeys,
    observedPath,
    source: effectiveSource,
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
            integrationType: undefined,
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
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="max-w-2xl text-xs text-muted-foreground">
          Define canonical context from fields observed in your integrations. Unmapped choices never
          satisfy negative conditions.
        </p>
        <LimitCounter count={draft.fields.length} limit={LIMITS.fields} noun="fields" />
      </div>
      <div
        className={cn(
          'grid min-w-0 gap-3.5',
          data.canEdit && 'xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]'
        )}
      >
        <div className="min-w-0 space-y-3.5">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Search context fields"
                placeholder="Search context fields…"
                value={contextSearch}
                onChange={event => setContextSearch(event.target.value)}
                className="search-input h-8.5 !pl-8 !pr-8 text-xs bg-background"
              />
              {contextSearch && (
                <button
                  type="button"
                  aria-label="Clear context search"
                  onClick={() => setContextSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
            {data.canEdit && (
              <Button
                variant="outline"
                size="sm"
                aria-label="New context field"
                className="h-8.5 gap-1.5 text-xs font-medium shrink-0"
                onClick={() => {
                  const formEl = document.getElementById(`${formId}-title`);
                  formEl?.scrollIntoView({ behavior: 'smooth' });
                  document.getElementById(`${formId}-label`)?.focus();
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New field
              </Button>
            )}
          </div>
          {draft.fields.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-8 text-center bg-card">
              <Database className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
              <p className="mt-2 text-xs font-semibold text-foreground">No context fields yet</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {data.canEdit
                  ? 'Add a field from an observed integration value below, or discover fields from recent alerts or a sample payload.'
                  : 'An editor can add context fields from observed integration values.'}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xs">
              <div
                aria-hidden="true"
                className="hidden gap-x-3 border-b border-border/60 bg-muted/30 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1fr)_minmax(0,1.2fr)]"
              >
                <span>Field</span>
                <span>Type</span>
                <span>Mappings &amp; values</span>
                <span>Source</span>
              </div>
              <ul aria-label="Context field catalog" className="divide-y divide-border/60">
                {visibleFields.map(field => (
                  <FieldCatalogRow
                    key={field.key}
                    field={field}
                    selected={selected?.key === field.key}
                    ruleCount={ruleCountsByFieldKey.get(field.key) ?? 0}
                    onSelect={setSelectedKey}
                  />
                ))}
              </ul>
              {!visibleFields.length && (
                <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
                  <p>No matching context fields for &ldquo;{contextSearch}&rdquo;.</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-medium gap-1.5"
                    onClick={() => setContextSearch('')}
                  >
                    <RotateCcw className="h-3 w-3" />
                    Clear search
                  </Button>
                </div>
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
              onClose={() => setSelectedKey(null)}
            />
          )}
          {data.canEdit && (
            <section
              aria-labelledby={`${formId}-title`}
              className="space-y-3 rounded-xl border border-border/80 bg-card p-3 sm:p-3.5 shadow-xs"
            >
              <div className="border-b border-border/60 pb-2">
                <h3
                  id={`${formId}-title`}
                  className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5"
                >
                  <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
                  Add context field
                </h3>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Pick where the value comes from, name it, then (for choices) list the canonical
                  values rules will compare against.
                </p>
              </div>
              <AuthoringFieldset compact legend="1. Source">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-integration`} className="text-xs font-medium">
                      Integration
                    </Label>
                    <NativeSelect
                      id={`${formId}-integration`}
                      className="h-8 text-xs bg-background"
                      value={integrationType}
                      onChange={e => {
                        if (handleIntegrationTypeChange) {
                          handleIntegrationTypeChange(e.target.value);
                        } else {
                          setIntegrationType(e.target.value);
                        }
                      }}
                    >
                      <option>EVENTS_API</option>
                      <option value="ALL">All providers</option>
                      {integrationTypes.map(t => (
                        <option key={t}>{t}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-observed`} className="text-xs font-medium">
                      Observed field
                    </Label>
                    <NativeSelect
                      id={`${formId}-observed`}
                      className="h-8 text-xs bg-background"
                      value={
                        observedOptions.find(
                          o =>
                            o.path === observedPath &&
                            (!effectiveIntType || o.integrationType === effectiveIntType) &&
                            (!effectiveSource || !o.source || o.source === effectiveSource)
                        )?.id ??
                        observedOptions.find(o => o.path === observedPath)?.id ??
                        observedPath
                      }
                      aria-invalid={!!problems.source || undefined}
                      aria-describedby={problems.source ? `${formId}-source-error` : undefined}
                      onChange={e => {
                        const val = e.target.value;
                        if (!val) {
                          if (selectObservedField) {
                            selectObservedField(null);
                          } else {
                            setObservedPath('');
                            setSource(undefined);
                            setIntType(undefined);
                          }
                          return;
                        }
                        const found = observedOptions.find(o => o.id === val);
                        if (found) {
                          if (selectObservedField) {
                            selectObservedField({
                              path: found.path,
                              source: found.source,
                              integrationType: found.integrationType,
                              label: found.label,
                              type: (found.type as Field['type']) || 'STRING',
                            });
                          } else {
                            setObservedPath(found.path);
                            if (found.source) setSource(found.source);
                            else setSource(undefined);
                            setIntType(found.integrationType);
                            setFieldLabel(found.label);
                            if (found.type) {
                              setFieldType(found.type as Field['type']);
                            }
                            if (found.integrationType && found.integrationType !== 'ALL') {
                              setIntegrationType(found.integrationType);
                            }
                          }
                          if (!found.source) {
                            setAdvanced(true);
                          }
                        } else {
                          setObservedPath(val);
                          setSource(undefined);
                          setIntType(undefined);
                        }
                      }}
                    >
                      <option value="">Choose field…</option>
                      {observedPath && !observedOptions.some(o => o.path === observedPath) && (
                        <option value={observedPath}>{observedPath}</option>
                      )}
                      {observedOptions.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.label} — {option.path}
                          {option.integrationType ? ` (${option.integrationType})` : ''}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>
                {observedOptions.length === 0 && (
                  <Hint className="text-[11px] leading-tight">
                    No observed fields for this integration yet. Use discovery to find fields, or
                    enter a path under Advanced mapping.
                  </Hint>
                )}
                <div className="pt-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    aria-expanded={advanced}
                    aria-controls={advanced ? `${formId}-advanced` : undefined}
                    onClick={() => setAdvanced(!advanced)}
                  >
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 transition-transform', advanced && 'rotate-180')}
                      aria-hidden="true"
                    />
                    Advanced mapping
                  </Button>
                  {advanced && (
                    <div
                      id={`${formId}-advanced`}
                      className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5"
                    >
                      <div className="space-y-1">
                        <Label htmlFor={`${formId}-source-type`} className="text-xs font-medium">
                          Payload source
                        </Label>
                        <NativeSelect
                          id={`${formId}-source-type`}
                          className="h-8 text-xs bg-background"
                          value={effectiveSource ?? ''}
                          aria-invalid={!effectiveSource && !!observedPath ? true : undefined}
                          onChange={e => setSource(e.target.value as 'PROVIDER' | 'EVENT')}
                        >
                          <option value="" disabled>
                            Choose payload source…
                          </option>
                          <option value="EVENT">
                            Normalized event (payload.*, event_action, etc.)
                          </option>
                          <option value="PROVIDER">
                            Raw provider webhook (e.g. GitHub, CloudWatch)
                          </option>
                        </NativeSelect>
                        <Hint className="text-[11px] leading-tight">
                          {effectiveSource === 'EVENT'
                            ? 'Extracted from OpsKnight standardized event payload (e.g. payload.*, event_action)'
                            : effectiveSource === 'PROVIDER'
                              ? 'Extracted directly from incoming third-party provider webhook body'
                              : 'Select whether this field is extracted from OpsKnight normalized event or raw provider webhook'}
                        </Hint>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`${formId}-path`} className="text-xs font-medium">
                          Source path
                        </Label>
                        <Input
                          id={`${formId}-path`}
                          className="h-8 font-mono text-xs bg-background"
                          placeholder={
                            effectiveSource === 'EVENT'
                              ? 'payload.custom_details.environment'
                              : 'repository.full_name'
                          }
                          value={observedPath}
                          onChange={e => {
                            setObservedPath(e.target.value);
                            setIntType(undefined);
                          }}
                        />
                        <Hint className="text-[11px] leading-tight">
                          Dot-separated path into the event or provider payload.
                        </Hint>
                      </div>
                    </div>
                  )}
                </div>
                {problems.source && (
                  <InlineError id={`${formId}-source-error`}>{problems.source}</InlineError>
                )}
              </AuthoringFieldset>
              <AuthoringFieldset compact legend="2. Name and type">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-label`} className="text-xs font-medium">
                      Field label
                    </Label>
                    <Input
                      id={`${formId}-label`}
                      maxLength={100}
                      className="h-8 text-xs bg-background"
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
                          <Hint className="text-[11px] leading-tight">
                            Key: <code className="font-mono">automation.{newKey}</code>
                          </Hint>
                        )
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`${formId}-type`} className="text-xs font-medium">
                      Treat as
                    </Label>
                    <NativeSelect
                      id={`${formId}-type`}
                      className="h-8 text-xs bg-background"
                      value={fieldType}
                      onChange={e => setFieldType(e.target.value as Field['type'])}
                    >
                      <option value="STRING">Text</option>
                      <option value="ENUM">Choice</option>
                      <option value="NUMBER">Number</option>
                      <option value="BOOLEAN">True / False</option>
                    </NativeSelect>
                    <Hint className="text-[11px] leading-tight">
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
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold tracking-tight text-foreground">
                    3. Canonical values
                  </p>
                  <CanonicalValuesEditor
                    values={values}
                    usedValues={EMPTY_SET}
                    onChange={setValues}
                  />
                  {problems.values && <InlineError>{problems.values}</InlineError>}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <Button
                  size="sm"
                  className="h-8 text-xs font-medium gap-1.5 shadow-xs"
                  disabled={
                    draft.fields.length >= LIMITS.fields ||
                    !fieldLabel.trim() ||
                    (fieldType === 'ENUM' && !values.length)
                  }
                  onClick={addField}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
            className="min-w-0 space-y-3.5 self-start rounded-xl border border-border/80 bg-card p-3.5 shadow-xs"
          >
            <div>
              <h3
                id={`${formId}-discover`}
                className="flex items-center gap-2 text-xs font-semibold tracking-tight text-foreground"
              >
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Discover fields from recent alerts or a sample
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Suggestions fill the Add context field form. Nothing is saved until you add the
                field.
              </p>
            </div>
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8.5 w-full text-xs font-medium"
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
                  const fieldSource =
                    field.source ?? (field.integrationType === 'EVENTS_API' ? 'EVENT' : 'PROVIDER');
                  const fieldCompositeId = `${field.integrationType ?? 'ALL'}:${fieldSource}:${field.path}`;
                  const currentCompositeId = `${effectiveIntType ?? 'ALL'}:${effectiveSource}:${observedPath}`;
                  const chosen = Boolean(observedPath) && fieldCompositeId === currentCompositeId;
                  return (
                    <li
                      key={fieldCompositeId}
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
                            if (selectObservedField) {
                              selectObservedField({
                                path: field.path,
                                source: field.source,
                                integrationType: field.integrationType,
                                label: hierarchical,
                                type: (field.type as Field['type']) || 'STRING',
                              });
                            } else {
                              setObservedPath(field.path);
                              if (field.source) setSource(field.source);
                              setIntType(field.integrationType);
                              setFieldLabel(hierarchical);
                              setFieldType(
                                field.type === 'NUMBER' ||
                                  field.type === 'BOOLEAN' ||
                                  field.type === 'ENUM'
                                  ? field.type
                                  : 'STRING'
                              );
                              if (field.integrationType && field.integrationType !== 'ALL') {
                                setIntegrationType(field.integrationType);
                              }
                            }
                            if (!field.source) {
                              setAdvanced(true);
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
