'use client';

import { useId, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import type { McpCapability } from '@/lib/mcp/catalog/capabilities';
import type {
  McpCapabilityScope,
  UpdateMcpCapabilitiesResult,
  UpdateMcpDisabledCapabilitiesInput,
} from '../capability-actions';
import McpCapabilityControlsPanel from './McpCapabilityControlsPanel';

export type McpCapabilityScopeOption = {
  /** Stable select value: `global`, `role:<Role>` or `client:<id>`. */
  value: string;
  label: string;
  scope: NonNullable<McpCapabilityScope>;
  disabled: string[];
};

function describe(option: McpCapabilityScopeOption) {
  if (option.scope.kind === 'role')
    return `Turned off only for people whose role is ${option.label}, in addition to the list for all roles. Takes effect on their next request.`;
  if (option.scope.kind === 'client')
    return `Turned off for everyone who uses ${option.label}, in addition to the lists for all roles and for their role. Takes effect on their next request.`;
  return undefined;
}

/**
 * The capability editor with a scope selector: the list for all roles, one role, or one
 * assistant. Restrictions only add up (effective-capabilities.ts); no scope can re-enable another's.
 */
export default function McpCapabilityScopedControls({
  capabilities,
  scopes,
  action,
}: {
  capabilities: McpCapability[];
  scopes: McpCapabilityScopeOption[];
  action: (input: UpdateMcpDisabledCapabilitiesInput) => Promise<UpdateMcpCapabilitiesResult>;
}) {
  const id = useId();
  const [selected, setSelected] = useState(scopes[0].value);
  // What each scope stored when last loaded or saved, so switching back shows the saved list.
  const [lists, setLists] = useState(() =>
    Object.fromEntries(scopes.map(option => [option.value, option.disabled]))
  );
  const [dirty, setDirty] = useState(false);
  const option = scopes.find(item => item.value === selected) ?? scopes[0];
  const groups = [
    { label: 'Everyone', items: scopes.filter(item => item.scope.kind === 'global') },
    { label: 'Role', items: scopes.filter(item => item.scope.kind === 'role') },
    { label: 'Assistant', items: scopes.filter(item => item.scope.kind === 'client') },
  ].filter(group => group.items.length);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor={`${id}-scope`} className="text-sm font-medium">
          Restrictions for
        </label>
        <Select value={selected} onValueChange={setSelected} disabled={dirty}>
          <SelectTrigger id={`${id}-scope`} className="h-9 w-full text-sm sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-72 overflow-y-auto">
            {groups.map(group => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.items.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.scope.kind === 'role' ? `Role: ${item.label}` : item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {dirty && (
          <p className="text-xs text-muted-foreground">
            Save or discard your changes to switch scope.
          </p>
        )}
      </div>
      <McpCapabilityControlsPanel
        key={option.value}
        capabilities={capabilities}
        initialDisabled={lists[option.value] ?? []}
        description={describe(option)}
        onDirtyChange={setDirty}
        action={async input => {
          const result = await action({ ...input, scope: option.scope });
          if (result.ok || result.code === 'MCP_POLICY_CONFLICT')
            setLists(previous => ({ ...previous, [option.value]: result.disabled }));
          return result;
        }}
      />
    </div>
  );
}
