'use client';
import { memo, useId, useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Switch } from '@/components/ui/shadcn/switch';
import { cn } from '@/lib/utils';
import { builtinFields, LIMITS, type Field, type Rule } from '@/lib/automation/contract';
import { CanonicalValuesEditor } from '../CanonicalValuesEditor';
import { AliasEditor } from '../AliasEditor';
import { FIELD_TYPE_LABELS } from './rule-language';
import { NativeSelect } from './primitives';
import type { Data } from '../presentation-types';

export function fieldSources(field: Field) {
  return [
    ...new Set(
      field.mappings.map(mapping =>
        mapping.source === 'EVENT'
          ? 'Normalized event'
          : (mapping.integrationType ?? 'All providers')
      )
    ),
  ];
}

export const FieldCatalogRow = memo(function FieldCatalogRow({
  field,
  selected,
  onSelect,
}: {
  field: Field;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const aliasCount = Object.keys(field.aliases).length;
  const sources = fieldSources(field);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(field.key)}
        className={cn(
          'grid min-h-10.5 w-full gap-x-3 gap-y-1 px-3.5 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary sm:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center',
          selected ? 'bg-primary/5 ring-1 ring-primary/30' : 'hover:bg-muted/40'
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">{field.label}</span>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">
            {field.key}
          </span>
        </span>
        <span>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
              field.type === 'ENUM'
                ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300'
                : field.type === 'BOOLEAN'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : field.type === 'NUMBER'
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-border/70 bg-muted/60 text-muted-foreground'
            )}
          >
            {FIELD_TYPE_LABELS[field.type]}
          </span>
        </span>
        <span className="text-[11px] text-muted-foreground">
          {field.mappings.length} {field.mappings.length === 1 ? 'mapping' : 'mappings'}
          {field.type === 'ENUM' && ` · ${field.allowedValues?.length ?? 0} choices`}
          {aliasCount > 0 && ` · ${aliasCount} ${aliasCount === 1 ? 'alias' : 'aliases'}`}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {sources.length ? sources.join(', ') : 'No source mapped'}
        </span>
      </button>
    </li>
  );
});

export const FieldDetail = memo(function FieldDetail({
  field,
  rules,
  observations,
  canEdit,
  canReadSensitive,
  updateField,
  onRemove,
}: {
  field: Field;
  rules: Rule[];
  observations: Data['observations'];
  canEdit: boolean;
  canReadSensitive: boolean;
  updateField: (key: string, update: Partial<Field>) => void;
  onRemove: (field: Field) => void;
}) {
  const caseId = useId();
  const usedValues = useMemo(
    () =>
      new Set([
        ...Object.values(field.aliases),
        ...rules.flatMap(rule => [
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
            a.type === 'SET_CONTEXT' && a.fieldKey === field.key ? [String(a.value)] : []
          ),
        ]),
      ]),
    [field.aliases, field.key, rules]
  );
  const unmapped = useMemo(
    () => observations.filter(o => o.fieldKey === field.key && o.unmapped),
    [observations, field.key]
  );
  const aliasSummary =
    Object.entries(field.aliases)
      .map(([from, to]) => `${from} → ${to}`)
      .join(', ') || 'None';
  return (
    <section
      aria-label={`${field.label} details`}
      className="min-w-0 space-y-4 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold tracking-tight">
            {field.label}
            <span className="rounded-md border border-border/70 px-1.5 py-px text-[11px] font-medium text-muted-foreground">
              {FIELD_TYPE_LABELS[field.type]}
            </span>
          </h3>
          <p className="font-mono text-xs text-muted-foreground">automation.{field.key}</p>
        </div>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-10 text-muted-foreground hover:text-destructive sm:h-9"
            onClick={() => onRemove(field)}
          >
            <Trash2 aria-hidden="true" />
            Remove field
          </Button>
        )}
      </div>
      <div className="space-y-1.5 rounded-md bg-muted/60 p-3 text-sm">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mapping provenance
        </h4>
        {field.mappings.length === 0 && (
          <p className="text-muted-foreground">
            No source mapping. This field is set by rules only.
          </p>
        )}
        {field.mappings.map((mapping, index) => (
          <p key={index} className="min-w-0">
            {mapping.integrationType ?? 'All integrations'} ·{' '}
            {mapping.source === 'EVENT' ? 'Normalized event' : 'Provider payload'} ·{' '}
            <code className="break-all font-mono text-xs">{mapping.path}</code>
          </p>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <p>Recognized: {field.allowedValues?.join(', ') || field.type.toLowerCase()}</p>
        <p className="text-muted-foreground">Aliases: {aliasSummary}</p>
      </div>
      {canEdit && (
        <div className="space-y-4">
          {field.type === 'ENUM' && (
            <CanonicalValuesEditor
              values={field.allowedValues ?? []}
              usedValues={usedValues}
              onChange={allowedValues => updateField(field.key, { allowedValues })}
            />
          )}
          <AliasEditor
            aliases={field.aliases}
            canonicalValues={field.type === 'ENUM' ? field.allowedValues : undefined}
            onChange={aliases => updateField(field.key, { aliases })}
          />
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
            <Switch
              id={caseId}
              checked={field.caseSensitive}
              onCheckedChange={caseSensitive => updateField(field.key, { caseSensitive })}
            />
            <Label htmlFor={caseId}>Case sensitive</Label>
            <span className="text-xs text-muted-foreground">
              {field.caseSensitive
                ? '“Prod” and “prod” are different values.'
                : '“Prod” and “prod” are treated as the same value.'}
            </span>
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
            <Switch
              id={`${caseId}-display`}
              checked={field.displayOnly ?? false}
              onCheckedChange={displayOnly => updateField(field.key, { displayOnly })}
            />
            <Label htmlFor={`${caseId}-display`}>Display-only field</Label>
            <span className="text-xs text-muted-foreground">
              Captured for incident presentation and runbook context without requiring rule
              conditions.
            </span>
          </div>
        </div>
      )}
      {unmapped.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Unmapped values seen in alerts</h4>
          <ul className="space-y-2">
            {unmapped.map(o => {
              const hidden = !canReadSensitive || o.rawValuePreview === '[redacted]';
              return (
                <li
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm"
                  key={o.id}
                >
                  <span className="rounded-md border border-amber-500/40 bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                    Unmapped
                  </span>
                  <span className="min-w-0 break-all">
                    {hidden ? 'Value hidden' : o.rawValuePreview} · {o.count} alerts
                  </span>
                  {canEdit && !hidden && (
                    <NativeSelect
                      aria-label={`Map ${o.rawValuePreview}`}
                      className="w-full sm:ml-auto sm:w-48"
                      value=""
                      onChange={e =>
                        updateField(field.key, {
                          aliases: { ...field.aliases, [o.rawValuePreview]: e.target.value },
                        })
                      }
                    >
                      <option value="">Map value…</option>
                      {field.allowedValues?.map(v => (
                        <option key={v}>{v}</option>
                      ))}
                    </NativeSelect>
                  )}
                </li>
              );
            })}
          </ul>
          {unmapped.some(o => !canReadSensitive || o.rawValuePreview === '[redacted]') && (
            <p className="text-xs text-muted-foreground">
              Raw values require sensitive incident access to view and map.
            </p>
          )}
        </div>
      )}
    </section>
  );
});

export const builtinFieldKeys = new Set(builtinFields.map(field => field.key));

export function deriveFieldKey(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function deriveUniqueFieldKey(label: string, existingKeys: Set<string>): string {
  const baseKey = deriveFieldKey(label) || 'field';
  const cleanBase = /^[a-z]/.test(baseKey) ? baseKey : `field_${baseKey}`;
  if (!existingKeys.has(cleanBase)) return cleanBase;
  let counter = 2;
  while (existingKeys.has(`${cleanBase}_${counter}`)) {
    counter++;
  }
  return `${cleanBase}_${counter}`;
}

export function newFieldProblems({
  label,
  key,
  existingKeys,
  observedPath,
  source,
  fieldCount,
  type,
  values,
}: {
  label: string;
  key: string;
  existingKeys: Set<string>;
  observedPath: string;
  source?: 'PROVIDER' | 'EVENT';
  fieldCount: number;
  type: Field['type'];
  values: string[];
}) {
  const problems: { label?: string; source?: string; values?: string; limit?: string } = {};
  if (fieldCount >= LIMITS.fields)
    problems.limit = `Field limit reached (${LIMITS.fields}). Remove a field to add another.`;
  if (label.trim()) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
      problems.label = 'Start with a letter and use letters, numbers and spaces (max 64).';
    else if (existingKeys.has(key)) problems.label = `A field with key “${key}” already exists.`;
    if (!observedPath)
      problems.source = 'Choose an observed field, or enter a source path under Advanced mapping.';
    else if (!source)
      problems.source = 'Select whether the source is a normalized event or raw provider payload.';
  }
  if (type === 'ENUM' && !values.length) problems.values = 'Add at least one canonical choice.';
  return problems;
}
