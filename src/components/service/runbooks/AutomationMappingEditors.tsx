'use client';

import { useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { contextTypeCompatibleWithInput, type ContextFieldOption } from './context-helpers';
import type { ServiceRunbookAgent, ServiceRunbookAgentPool } from '../ServiceRunbooks';
import type { RunbookInputType } from '@/lib/runbooks/types';
import { NativeSelect } from '@/components/automation/authoring/primitives';

export type MappingInputDefinition = {
  key: string;
  label: string;
  type: string;
  required: boolean;
};

export function ContextInputMappingEditor({
  inputs,
  contextFields,
  defaultValue,
}: {
  inputs: MappingInputDefinition[];
  contextFields: ContextFieldOption[];
  defaultValue: Array<{ inputKey: string; contextKey: string }>;
}) {
  const id = useId();
  const [mapping, setMapping] = useState<Record<string, string>>(() =>
    Object.fromEntries(defaultValue.map(item => [item.inputKey, item.contextKey]))
  );
  const mappable = inputs.filter(input => input.type !== 'SECRET_REF');
  const serialized = JSON.stringify(
    Object.entries(mapping)
      .filter(([inputKey, contextKey]) => contextKey && inputs.some(i => i.key === inputKey))
      .map(([inputKey, contextKey]) => ({ inputKey, contextKey }))
  );
  return (
    <fieldset className="space-y-2 rounded-md border bg-background/60 p-3">
      <legend className="px-1 text-sm font-medium">Inputs from automation context</legend>
      <input type="hidden" name="contextInputMappings" value={serialized} />
      {mappable.length === 0 || contextFields.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {mappable.length === 0
            ? 'This runbook version has no inputs that can be mapped.'
            : 'Publish automation fields for this service to map runbook inputs.'}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {mappable.map(input => {
            const compatible = contextFields.filter(field =>
              contextTypeCompatibleWithInput(field.type, input.type as RunbookInputType)
            );
            const selectId = `${id}-${input.key}`;
            return (
              <div key={input.key} className="space-y-1">
                <Label htmlFor={selectId} className="text-xs">
                  {input.label}
                  {input.required ? ' *' : ''}{' '}
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {input.type.toLowerCase()}
                  </span>
                </Label>
                <NativeSelect
                  id={selectId}
                  value={mapping[input.key] ?? ''}
                  onChange={event =>
                    setMapping(current => ({ ...current, [input.key]: event.target.value }))
                  }
                >
                  <option value="">Configured value</option>
                  {compatible.map(field => (
                    <option key={field.key} value={field.key}>
                      automation.{field.key} ({field.type.toLowerCase()})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Required inputs whose automation value is missing, unmapped or invalid block automatic
        execution and record a skip reason. Optional inputs fall back to the configured value.
        Secrets always use secret references.
      </p>
    </fieldset>
  );
}

type TargetRow = { id: number; value: string; target: string };

function displayValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function typedValue(field: ContextFieldOption | undefined, raw: string): unknown {
  if (field?.type === 'NUMBER') return raw.trim() === '' ? raw : Number(raw);
  if (field?.type === 'BOOLEAN') return raw === 'true' ? true : raw === 'false' ? false : raw;
  return raw;
}

export function ContextTargetMappingEditor({
  contextFields,
  agents,
  pools,
  defaultValue,
}: {
  contextFields: ContextFieldOption[];
  agents: ServiceRunbookAgent[];
  pools: ServiceRunbookAgentPool[];
  defaultValue: {
    contextKey?: string | null;
    entries?: Array<{ value: unknown; agentId?: string; agentPoolId?: string }>;
  };
}) {
  const id = useId();
  const [contextKey, setContextKey] = useState(defaultValue.contextKey ?? '');
  const [rows, setRows] = useState<TargetRow[]>(() =>
    (defaultValue.entries ?? []).map((entry, index) => ({
      id: index,
      value: displayValue(entry.value),
      target: entry.agentId
        ? `agent:${entry.agentId}`
        : entry.agentPoolId
          ? `pool:${entry.agentPoolId}`
          : '',
    }))
  );
  const [nextId, setNextId] = useState(rows.length);
  const field = contextFields.find(candidate => candidate.key === contextKey);
  const knownKey = !contextKey || Boolean(field);
  const serialized = useMemo(
    () =>
      JSON.stringify(
        contextKey
          ? {
              contextKey,
              entries: rows.map(row => {
                const [kind, targetId] = row.target.split(':', 2);
                return {
                  value: typedValue(field, row.value),
                  ...(kind === 'agent' ? { agentId: targetId } : {}),
                  ...(kind === 'pool' ? { agentPoolId: targetId } : {}),
                };
              }),
            }
          : { contextKey: null, entries: [] }
      ),
    [contextKey, rows, field]
  );
  const update = (rowId: number, patch: Partial<TargetRow>) =>
    setRows(current => current.map(row => (row.id === rowId ? { ...row, ...patch } : row)));
  const choices =
    field?.type === 'ENUM'
      ? (field.allowedValues ?? [])
      : field?.type === 'BOOLEAN'
        ? ['true', 'false']
        : null;

  return (
    <fieldset className="space-y-2 rounded-md border bg-background/60 p-3">
      <legend className="px-1 text-sm font-medium">Approved targets by automation value</legend>
      <input type="hidden" name="contextTargetMappings" value={serialized} />
      <div className="space-y-1">
        <Label htmlFor={`${id}-key`} className="text-xs">
          Select target by
        </Label>
        <NativeSelect
          id={`${id}-key`}
          value={contextKey}
          onChange={event => {
            setContextKey(event.target.value);
            setRows([]);
          }}
        >
          <option value="">Not used — automatic runs use the execution target</option>
          {!knownKey && <option value={contextKey}>automation.{contextKey} (not published)</option>}
          {contextFields.map(option => (
            <option key={option.key} value={option.key}>
              automation.{option.key} ({option.type.toLowerCase()})
            </option>
          ))}
        </NativeSelect>
      </div>
      {!knownKey && (
        <p role="alert" className="text-[11px] text-destructive">
          automation.{contextKey} is no longer published; automatic execution is blocked until the
          mapping is updated.
        </p>
      )}
      {contextKey && (
        <table className="w-full text-xs" aria-label="Approved target mapping">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-1 font-medium">automation.{contextKey} value</th>
              <th className="pb-1 font-medium">Approved Agent pool or Agent</th>
              <th className="sr-only">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="py-1 pr-2">
                  {choices ? (
                    <NativeSelect
                      aria-label={`Mapping ${index + 1} value`}
                      value={row.value}
                      onChange={event => update(row.id, { value: event.target.value })}
                    >
                      <option value="">Select value</option>
                      {choices.map(choice => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      aria-label={`Mapping ${index + 1} value`}
                      value={row.value}
                      inputMode={field?.type === 'NUMBER' ? 'decimal' : undefined}
                      onChange={event => update(row.id, { value: event.target.value })}
                      className="h-9 text-xs"
                    />
                  )}
                </td>
                <td className="py-1 pr-2">
                  <NativeSelect
                    aria-label={`Mapping ${index + 1} target`}
                    value={row.target}
                    onChange={event => update(row.id, { target: event.target.value })}
                  >
                    <option value="">Select target</option>
                    <optgroup label="Agent pools">
                      {pools.map(pool => (
                        <option key={pool.id} value={`pool:${pool.id}`}>
                          {pool.name} ({pool.mode})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Agents">
                      {agents.map(agent => (
                        <option key={agent.id} value={`agent:${agent.id}`}>
                          {agent.name}
                          {agent.hostname ? ` · ${agent.hostname}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  </NativeSelect>
                </td>
                <td className="py-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove mapping ${index + 1}`}
                    onClick={() => setRows(current => current.filter(item => item.id !== row.id))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {contextKey && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => {
            setRows(current => [...current, { id: nextId, value: '', target: '' }]);
            setNextId(value => value + 1);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add approved value
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Only exact canonical values listed here can select a target. Any other value blocks
        automatic execution; Agent ids are never taken from alert content. The selected target is
        re-checked for health and capability at dispatch.
      </p>
    </fieldset>
  );
}
