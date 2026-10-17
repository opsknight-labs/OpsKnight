'use client';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/shadcn/card';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { CanonicalValuesEditor } from './CanonicalValuesEditor';
import { AliasEditor } from './AliasEditor';

import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
import type { Snapshot, Field } from '@/lib/automation/contract';
import type { Observation } from '@/lib/automation/discovery';

import type { Data, Discovery } from './presentation-types';
const controlClass = 'rounded-md border border-input bg-background px-3 py-2 text-sm max-w-full';
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
  const visibleFields = useMemo(
    () =>
      draft.fields.filter(field =>
        `${field.label} ${field.key}`.toLowerCase().includes(contextSearch.toLowerCase())
      ),
    [draft.fields, contextSearch]
  );
  const selected = visibleFields.find(field => field.key === selectedKey) ?? visibleFields[0];
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Define canonical context from fields observed in your integrations. Unmapped choices never
        satisfy negative conditions.
      </p>
      <Input
        aria-label="Search context fields"
        placeholder="Search context fields…"
        value={contextSearch}
        onChange={event => setContextSearch(event.target.value)}
      />
      <div aria-label="Context field catalog" className="flex flex-wrap gap-2">
        {visibleFields.map(field => (
          <Button
            key={field.key}
            variant={selected?.key === field.key ? 'secondary' : 'outline'}
            aria-pressed={selected?.key === field.key}
            onClick={() => setSelectedKey(field.key)}
          >
            {field.label} · {field.type}
          </Button>
        ))}
      </div>
      {!visibleFields.length && (
        <p className="text-sm text-muted-foreground">No matching context fields.</p>
      )}
      {[...(selected ? [selected] : [])].map(field => (
        <Card key={field.key}>
          <CardHeader>
            <CardTitle className="text-base">
              {field.label} <Badge>{field.type}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md bg-muted p-3 text-sm space-y-1">
              <h4 className="font-medium">Mapping provenance</h4>
              {field.mappings.map((mapping, index) => (
                <p key={index}>
                  {mapping.integrationType ?? 'All integrations'} ·{' '}
                  {mapping.source === 'EVENT' ? 'Normalized event' : 'Provider payload'} ·{' '}
                  <code className="break-all">{mapping.path}</code>
                </p>
              ))}
            </div>
            <p className="text-sm">
              Recognized: {field.allowedValues?.join(', ') || field.type.toLowerCase()}
            </p>
            <p className="text-sm">
              Aliases:{' '}
              {Object.entries(field.aliases)
                .map(([from, to]) => `${from} → ${to}`)
                .join(', ') || 'None'}
            </p>
            {data.canEdit && (
              <>
                {field.type === 'ENUM' && (
                  <CanonicalValuesEditor
                    values={field.allowedValues ?? []}
                    usedValues={
                      new Set([
                        ...Object.values(field.aliases),
                        ...draft.rules.flatMap(rule => [
                          ...rule.conditions
                            .filter(c => c.fieldKey === field.key)
                            .flatMap(c =>
                              Array.isArray(c.value)
                                ? c.value.map(String)
                                : typeof c.value === 'string'
                                  ? [c.value]
                                  : []
                            ),
                          ...rule.actions.flatMap(a =>
                            a.type === 'SET_CONTEXT' && a.fieldKey === field.key
                              ? [String(a.value)]
                              : []
                          ),
                        ]),
                      ])
                    }
                    onChange={allowedValues => updateField(field.key, { allowedValues })}
                  />
                )}
                <AliasEditor
                  aliases={field.aliases}
                  canonicalValues={field.type === 'ENUM' ? field.allowedValues : undefined}
                  onChange={aliases => updateField(field.key, { aliases })}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={field.caseSensitive}
                    onChange={e => updateField(field.key, { caseSensitive: e.target.checked })}
                  />
                  Case sensitive
                </label>
                <Button variant="ghost" size="sm" onClick={() => setDeleteField(field)}>
                  Remove field
                </Button>
              </>
            )}
            <div>
              {data.observations
                .filter(o => o.fieldKey === field.key && o.unmapped)
                .map(o => (
                  <div className="flex flex-wrap items-center gap-2 text-sm" key={o.id}>
                    <Badge variant="outline">Unmapped</Badge>
                    {o.rawValuePreview} · {o.count} alerts{' '}
                    {data.canEdit && (
                      <select
                        aria-label={`Map ${o.rawValuePreview}`}
                        className={controlClass}
                        value=""
                        onChange={e =>
                          updateField(field.key, {
                            aliases: {
                              ...field.aliases,
                              [o.rawValuePreview]: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Map value…</option>
                        {field.allowedValues?.map(v => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      ))}
      {data.canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add context field</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="block text-sm">
              1. Choose source
              <select
                className={`${controlClass} block w-full`}
                value={integrationType}
                onChange={e => setIntegrationType(e.target.value)}
              >
                <option>EVENTS_API</option>
                <option value="ALL">All providers</option>
                {[...new Set(data.integrations.map(i => i.type))].map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              2. Choose observed field
              <select
                className={`${controlClass} block w-full`}
                value={observedPath}
                onChange={e => {
                  setObservedPath(e.target.value);
                  const found = [
                    ...data.observations.map(o => ({ path: o.sourcePath, key: o.fieldKey })),
                    ...discoveries,
                  ].find(o => o.path === e.target.value);
                  if (found) setFieldLabel(found.key.replace(/_/g, ' '));
                }}
              >
                <option value="">Choose field…</option>
                {[
                  ...new Map([
                    ...data.observations
                      .filter(
                        o => integrationType === 'ALL' || o.integrationType === integrationType
                      )
                      .map(o => [o.sourcePath, o.fieldKey] as const),
                    ...discoveries.map(o => [o.path, o.key] as const),
                  ]).entries(),
                ].map(([path, key]) => (
                  <option key={path} value={path}>
                    {key.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Field label
              <Input value={fieldLabel} onChange={e => setFieldLabel(e.target.value)} />
            </label>
            <label className="block text-sm">
              3. Treat as
              <select
                className={`${controlClass} block w-full`}
                value={fieldType}
                onChange={e => setFieldType(e.target.value as Field['type'])}
              >
                <option value="STRING">Text</option>
                <option value="ENUM">Choice</option>
                <option value="NUMBER">Number</option>
                <option value="BOOLEAN">True / False</option>
              </select>
            </label>
            {fieldType === 'ENUM' && (
              <div className="space-y-2">
                <p className="text-sm">4. Canonical values</p>
                <CanonicalValuesEditor
                  values={values}
                  usedValues={new Set()}
                  onChange={setValues}
                />
              </div>
            )}
            <Button
              disabled={
                draft.fields.length >= 64 ||
                !fieldLabel.trim() ||
                (fieldType === 'ENUM' && !values.length)
              }
              onClick={addField}
            >
              Add field
            </Button>
            <Button variant="ghost" onClick={() => setAdvanced(!advanced)}>
              Advanced mapping
            </Button>
            {advanced && (
              <label className="block text-sm">
                Source path
                <Input value={observedPath} onChange={e => setObservedPath(e.target.value)} />
              </label>
            )}
            <details>
              <summary className="cursor-pointer text-sm">
                Discover fields from recent alerts or a sample
              </summary>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    try {
                      const response = await automationAction({
                        action: 'discoverRecent',
                        serviceId,
                      });
                      if (!response.ok) setError(response.error);
                      else {
                        setDiscoveries(response.data as Observation[]);
                        if (!(response.data as Observation[]).length)
                          setError(
                            'No suitable fields in recent alerts. Use a provider sample to get started.'
                          );
                      }
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Discover from recent alerts
              </Button>
              {discoveries.length > 0 && (
                <div aria-label="Discovered context fields" className="my-3 space-y-2">
                  {discoveries.map(field => (
                    <div key={field.path} className="rounded-md border p-3 text-sm space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {field.path.split('.').at(-1)?.replace(/_/g, ' ')}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setObservedPath(field.path);
                            setFieldLabel(
                              field.path.split('.').at(-1)?.replace(/_/g, ' ') ?? field.key
                            );
                            setFieldType(
                              field.type === 'NUMBER' || field.type === 'BOOLEAN'
                                ? field.type
                                : 'STRING'
                            );
                          }}
                        >
                          Choose field
                        </Button>
                      </div>
                      <p className="break-all text-muted-foreground">
                        {field.path} · {field.type}
                        {field.frequency ? ` · ${field.frequency} recent alerts` : ''}
                      </p>
                      <p className="break-words">
                        Examples: {(field.examples ?? [field.value]).join(', ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                aria-label="Discovery sample"
                className={`${controlClass} w-full min-h-32`}
                value={providerSample}
                onChange={e => setProviderSample(e.target.value)}
              />
              <Button size="sm" onClick={() => void analyze()}>
                Analyze sample
              </Button>
            </details>
          </CardContent>
        </Card>
      )}
    </>
  );
}
