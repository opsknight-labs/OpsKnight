'use client';
import { useState } from 'react';
import { FormSelect } from './RunbookControls';

export type RunbookTargetOptions = {
  agents: Array<{ id: string; name: string; hostname: string | null }>;
  pools: Array<{ id: string; name: string; mode: string; _count?: { members: number } }>;
};
export default function RunbookTargetSelect({
  agents,
  pools,
  defaultValue = 'none',
  hasAgentWrite = false,
}: RunbookTargetOptions & { defaultValue?: string; hasAgentWrite?: boolean }) {
  const [value, setValue] = useState(defaultValue || 'none');
  const invalid =
    hasAgentWrite &&
    pools.some(
      pool =>
        value === `pool:${pool.id}` &&
        pool.mode === 'LOCAL_HOSTS' &&
        (pool._count?.members ?? 0) > 1
    );
  return (
    <div className="space-y-2">
      <FormSelect
        name="executionTarget"
        label="Execution target"
        value={value}
        onValueChange={setValue}
        options={[
          { value: 'none', label: 'No Agent target · control-plane steps only' },
          ...pools.map(pool => ({
            value: `pool:${pool.id}`,
            label: `${pool.name} · ${pool.mode.replaceAll('_', ' ')}${pool._count ? ` · ${pool._count.members} Agents` : ''}`,
            disabled:
              hasAgentWrite && pool.mode === 'LOCAL_HOSTS' && (pool._count?.members ?? 0) > 1,
          })),
          ...agents.map(agent => ({
            value: `agent:${agent.id}`,
            label: `${agent.name}${agent.hostname ? ` · ${agent.hostname}` : ''}`,
          })),
        ]}
      />
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          Machine-specific write actions require a specific Agent. Select one before saving.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Secret-backed steps require an Agent connected over HTTPS.
      </p>
    </div>
  );
}
