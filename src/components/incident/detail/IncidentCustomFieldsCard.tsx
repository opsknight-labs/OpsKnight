'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal, Settings, Plus, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Switch } from '@/components/ui/shadcn/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/toast';
import { FIELD_SELECT_CLASS, FIELD_VALUE_CLASS } from '@/components/incident/field-styles';

export type CustomFieldValue = {
  id: string;
  value: string | null;
  customField: {
    id: string;
    name: string;
    key: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
    required: boolean;
    defaultValue?: string | null;
    options?: unknown;
  };
};

export type IncidentCustomFieldsCardProps = {
  incidentId: string;
  customFieldValues: CustomFieldValue[];
  allCustomFields: Array<{
    id: string;
    name: string;
    key: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT' | 'BOOLEAN' | 'URL' | 'EMAIL';
    required: boolean;
    defaultValue?: string | null;
    options?: unknown;
  }>;
  canManage: boolean;
  className?: string;
  /** Rows only, for the Details panel (nothing when no fields are defined). */
  embedded?: boolean;
};

function formatFieldValue(value: string | null, type: string): string {
  if (!value) return '';
  if (type === 'BOOLEAN') return value === 'true' ? 'Yes' : 'No';
  if (type === 'DATE') {
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  }
  return value;
}

// DATE values are stored as ISO timestamps, but <input type="date"> only accepts
// yyyy-mm-dd and renders anything else as blank (then blur would erase it).
function toInputValue(value: string, type: string): string {
  return type === 'DATE' && value ? value.slice(0, 10) : value;
}

export default function IncidentCustomFieldsCard({
  incidentId,
  customFieldValues,
  allCustomFields,
  canManage,
  className,
  embedded = false,
}: IncidentCustomFieldsCardProps) {
  const router = useRouter();

  // Create lookup for initial values
  const valueMap = new Map(customFieldValues.map(v => [v.customField.id, v.value || '']));
  // Only stored values: a field's default is shown as a hint, never as if it had been saved.
  const [formValues, setFormValues] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    for (const field of allCustomFields) {
      initial.set(field.id, toInputValue(valueMap.get(field.id) ?? '', field.type));
    }
    return initial;
  });
  // Last value sent to the server per field. onChange already writes formValues,
  // so "changed" must be judged against this, not against formValues.
  const savedValues = useRef<Map<string, string>>(new Map(formValues));

  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [savedFieldId, setSavedFieldId] = useState<string | null>(null);

  const handleSave = async (fieldId: string, newValue: string) => {
    const previous = savedValues.current.get(fieldId) ?? '';
    if (previous === newValue) return;
    savedValues.current.set(fieldId, newValue);

    setSavingFieldId(fieldId);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customFieldId: fieldId,
          value: newValue,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to update custom field');
      }

      setFormValues(prev => {
        const next = new Map(prev);
        next.set(fieldId, newValue);
        return next;
      });
      setSavedFieldId(fieldId);
      setTimeout(() => setSavedFieldId(null), 2000);
      router.refresh();
    } catch (err) {
      savedValues.current.set(fieldId, previous);
      notify.error(err instanceof Error ? err.message : 'Failed to update custom field');
    } finally {
      setSavingFieldId(null);
    }
  };

  const inputClass = 'h-8 px-2.5 text-sm shadow-2xs';

  const rows = (
    <div className="flex flex-col divide-y divide-border/50">
      {allCustomFields.map(field => {
        const currentValue = formValues.get(field.id) ?? '';
        const isSaving = savingFieldId === field.id;
        const isSaved = savedFieldId === field.id;
        const options: string[] = Array.isArray(field.options) ? (field.options as string[]) : [];
        const unsetHint = field.defaultValue
          ? `Default: ${formatFieldValue(field.defaultValue, field.type)} (not saved)`
          : null;

        return (
          <div
            key={field.id}
            className="grid min-h-10 min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2 px-3 py-1.5"
          >
            {/* Field label & save state */}
            <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
              <span className="truncate" title={field.name}>
                {field.name}
              </span>
              {field.required && (
                <span className="text-rose-600 dark:text-rose-400" title="Required">
                  *
                </span>
              )}
              {isSaving && (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-label="Saving" />
              )}
              {isSaved && (
                <Check
                  className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-label="Saved"
                />
              )}
            </div>

            {/* Input / Control / Display */}
            {canManage ? (
              field.type === 'SELECT' ? (
                <Select
                  value={currentValue}
                  onValueChange={val => {
                    setFormValues(prev => new Map(prev).set(field.id, val));
                    void handleSave(field.id, val);
                  }}
                >
                  <SelectTrigger
                    aria-label={field.name}
                    className={cn(FIELD_SELECT_CLASS, 'w-full justify-between')}
                  >
                    <SelectValue placeholder={unsetHint ?? 'Select option...'} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((opt: string) => (
                      <SelectItem key={opt} value={opt} className="text-sm">
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : field.type === 'BOOLEAN' ? (
                <div className="flex h-8 items-center gap-2">
                  <Switch
                    aria-label={field.name}
                    checked={currentValue === 'true'}
                    onCheckedChange={checked => {
                      const val = checked ? 'true' : 'false';
                      setFormValues(prev => new Map(prev).set(field.id, val));
                      void handleSave(field.id, val);
                    }}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {currentValue === ''
                      ? (unsetHint ?? 'Not set')
                      : currentValue === 'true'
                        ? 'Yes'
                        : 'No'}
                  </span>
                </div>
              ) : field.type === 'DATE' ? (
                <Input
                  type="date"
                  aria-label={field.name}
                  value={currentValue}
                  onChange={e => setFormValues(prev => new Map(prev).set(field.id, e.target.value))}
                  onBlur={e => void handleSave(field.id, e.target.value)}
                  className={inputClass}
                />
              ) : field.type === 'NUMBER' ? (
                <Input
                  type="number"
                  aria-label={field.name}
                  value={currentValue}
                  placeholder={unsetHint ?? '0'}
                  onChange={e => setFormValues(prev => new Map(prev).set(field.id, e.target.value))}
                  onBlur={e => void handleSave(field.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      void handleSave(field.id, (e.target as HTMLInputElement).value);
                    }
                  }}
                  className={inputClass}
                />
              ) : (
                <Input
                  type={field.type === 'EMAIL' ? 'email' : field.type === 'URL' ? 'url' : 'text'}
                  aria-label={field.name}
                  value={currentValue}
                  placeholder={
                    unsetHint ??
                    (field.type === 'URL'
                      ? 'https://...'
                      : field.type === 'EMAIL'
                        ? 'user@example.com'
                        : 'Enter value...')
                  }
                  onChange={e => setFormValues(prev => new Map(prev).set(field.id, e.target.value))}
                  onBlur={e => void handleSave(field.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      void handleSave(field.id, (e.target as HTMLInputElement).value);
                    }
                  }}
                  className={inputClass}
                />
              )
            ) : currentValue ? (
              <span className={FIELD_VALUE_CLASS}>
                <span className="truncate">{formatFieldValue(currentValue, field.type)}</span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Not set</span>
            )}
          </div>
        );
      })}
    </div>
  );
  if (embedded) return allCustomFields.length ? rows : null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/80 bg-card text-card-foreground shadow-2xs',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/20 px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          Custom fields
          {allCustomFields.length > 0 && (
            <span className="font-normal tabular-nums text-muted-foreground">
              {allCustomFields.length}
            </span>
          )}
        </h2>

        {canManage && (
          <Link
            href="/settings/custom-fields"
            title="Configure Custom Fields"
            aria-label="Configure custom fields"
            className="-my-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {allCustomFields.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <SlidersHorizontal className="mx-auto mb-1.5 h-5 w-5 text-muted-foreground" />
          <p className="text-xs font-medium text-foreground">No custom fields</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Track metadata like Environment, Affected Region, or Root Cause.
          </p>
          {canManage && (
            <Link href="/settings/custom-fields" className="mt-3 inline-block">
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
                <Plus className="h-3.5 w-3.5" />
                <span>Configure</span>
              </Button>
            </Link>
          )}
        </div>
      ) : (
        rows
      )}
    </div>
  );
}
