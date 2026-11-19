'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal, Settings, Plus, Loader2, Check } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
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
}: IncidentCustomFieldsCardProps) {
  const router = useRouter();

  // Create lookup for initial values
  const valueMap = new Map(customFieldValues.map(v => [v.customField.id, v.value || '']));
  const [formValues, setFormValues] = useState<Map<string, string>>(() => {
    const initial = new Map<string, string>();
    for (const field of allCustomFields) {
      initial.set(
        field.id,
        toInputValue(valueMap.get(field.id) ?? (field.defaultValue || ''), field.type)
      );
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

  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-zinc-900 dark:border-zinc-800 transition-all',
        className
      )}
    >
      {/* Card Header */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-zinc-800/80 bg-slate-50/50 dark:bg-zinc-800/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded-md bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400">
            <SlidersHorizontal className="h-4 w-4 shrink-0" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-zinc-200 whitespace-nowrap">
              Custom Fields
            </h3>
            {allCustomFields.length > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] h-4.5 px-1.5 font-semibold text-slate-600 bg-slate-100 dark:bg-zinc-800 dark:text-zinc-400 shrink-0"
              >
                {allCustomFields.length}
              </Badge>
            )}
          </div>
        </div>

        {canManage && (
          <Link
            href="/settings/custom-fields"
            title="Configure Custom Fields"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 transition-colors p-1 rounded-md hover:bg-slate-100 dark:hover:bg-zinc-800"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>

      {/* Card Content */}
      <div className="p-3.5">
        {allCustomFields.length === 0 ? (
          <div className="py-4 text-center">
            <SlidersHorizontal className="h-6 w-6 mx-auto text-slate-300 dark:text-zinc-600 mb-1.5" />
            <p className="text-xs font-semibold text-slate-700 dark:text-zinc-300">
              No Custom Fields
            </p>
            <p className="text-[11px] text-slate-400 dark:text-zinc-500 mt-0.5 leading-relaxed">
              Track metadata like Environment, Affected Region, or Root Cause.
            </p>
            {canManage && (
              <Link href="/settings/custom-fields" className="inline-block mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5 border-slate-200 dark:border-zinc-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Configure</span>
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {allCustomFields.map(field => {
              const currentValue = formValues.get(field.id) ?? '';
              const isSaving = savingFieldId === field.id;
              const isSaved = savedFieldId === field.id;
              const options: string[] = Array.isArray(field.options)
                ? (field.options as string[])
                : [];

              return (
                <div
                  key={field.id}
                  className="p-2.5 rounded-lg border border-slate-100 dark:border-zinc-800/80 bg-slate-50/40 dark:bg-zinc-800/20 space-y-1.5"
                >
                  {/* Field Label & Indicators */}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate">
                        {field.name}
                      </span>
                      {field.required && (
                        <span className="text-[10px] text-rose-500 font-bold" title="Required">
                          *
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSaving && (
                        <span className="flex items-center gap-1 text-[10px] text-ink-400">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          <span>Saving</span>
                        </span>
                      )}
                      {isSaved && (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <Check className="h-3 w-3" />
                          <span>Saved</span>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Input / Control / Display */}
                  {canManage ? (
                    <div>
                      {field.type === 'SELECT' ? (
                        <Select
                          value={currentValue}
                          onValueChange={val => {
                            setFormValues(prev => new Map(prev).set(field.id, val));
                            void handleSave(field.id, val);
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700">
                            <SelectValue placeholder="Select option..." />
                          </SelectTrigger>
                          <SelectContent>
                            {options.map((opt: string) => (
                              <SelectItem key={opt} value={opt} className="text-xs">
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : field.type === 'BOOLEAN' ? (
                        <div className="flex items-center justify-between h-8 px-2 rounded-md bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700">
                          <span className="text-xs text-slate-700 dark:text-zinc-300 font-medium">
                            {currentValue === 'true' ? 'Yes' : 'No'}
                          </span>
                          <Switch
                            checked={currentValue === 'true'}
                            onCheckedChange={checked => {
                              const val = checked ? 'true' : 'false';
                              setFormValues(prev => new Map(prev).set(field.id, val));
                              void handleSave(field.id, val);
                            }}
                          />
                        </div>
                      ) : field.type === 'DATE' ? (
                        <Input
                          type="date"
                          value={currentValue}
                          onChange={e =>
                            setFormValues(prev => new Map(prev).set(field.id, e.target.value))
                          }
                          onBlur={e => void handleSave(field.id, e.target.value)}
                          className="h-8 text-xs bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                        />
                      ) : field.type === 'NUMBER' ? (
                        <Input
                          type="number"
                          value={currentValue}
                          placeholder="0"
                          onChange={e =>
                            setFormValues(prev => new Map(prev).set(field.id, e.target.value))
                          }
                          onBlur={e => void handleSave(field.id, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              void handleSave(field.id, (e.target as HTMLInputElement).value);
                            }
                          }}
                          className="h-8 text-xs bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                        />
                      ) : (
                        <Input
                          type={
                            field.type === 'EMAIL' ? 'email' : field.type === 'URL' ? 'url' : 'text'
                          }
                          value={currentValue}
                          placeholder={
                            field.type === 'URL'
                              ? 'https://...'
                              : field.type === 'EMAIL'
                                ? 'user@example.com'
                                : 'Enter value...'
                          }
                          onChange={e =>
                            setFormValues(prev => new Map(prev).set(field.id, e.target.value))
                          }
                          onBlur={e => void handleSave(field.id, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              void handleSave(field.id, (e.target as HTMLInputElement).value);
                            }
                          }}
                          className="h-8 text-xs bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-800 dark:text-zinc-200">
                      {currentValue ? (
                        <span className="font-medium">
                          {formatFieldValue(currentValue, field.type)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-zinc-500 italic">Not set</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
