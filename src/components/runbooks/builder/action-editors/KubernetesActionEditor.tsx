'use client';

import { useState } from 'react';
import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { Button } from '@/components/ui/shadcn/button';
import { FormSelect } from '../../RunbookControls';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

interface KubernetesActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs: RunbookInputInput[];
  editorId?: string;
  readOnly?: boolean;
  onChange: (config: Record<string, unknown>) => void;
}

const KUBERNETES_ACTIONS = [
  { value: 'get', label: 'Get (Read resource metadata)' },
  { value: 'describe', label: 'Describe (Detailed status and events)' },
  { value: 'logs', label: 'Logs (Container log output)' },
  { value: 'events', label: 'Events (Cluster events for object)' },
  { value: 'rollout-status', label: 'Rollout Status (Monitor deployment progress)' },
  { value: 'rollout-restart', label: 'Rollout Restart (Trigger rolling reload - Approval Required)' },
  { value: 'scale', label: 'Scale (Adjust replica count)' },
];

function resourceOptionsFor(action: string, inputs: RunbookInputInput[] = [], currentResource = '') {
  let base: { value: string; label: string }[];
  if (['rollout-restart', 'rollout-status'].includes(action)) {
    base = [
      { value: 'deployment', label: 'Deployment' },
      { value: 'daemonset', label: 'DaemonSet' },
      { value: 'statefulset', label: 'StatefulSet' },
    ];
  } else if (action === 'scale') {
    base = [
      { value: 'deployment', label: 'Deployment' },
      { value: 'statefulset', label: 'StatefulSet' },
      { value: 'replicaset', label: 'ReplicaSet' },
      { value: 'replicationcontroller', label: 'ReplicationController' },
    ];
  } else if (action === 'logs') {
    base = [
      { value: 'pod', label: 'Pod' },
      { value: 'deployment', label: 'Deployment' },
      { value: 'daemonset', label: 'DaemonSet' },
      { value: 'statefulset', label: 'StatefulSet' },
    ];
  } else {
    base = [
      { value: 'pod', label: 'Pod' },
      { value: 'deployment', label: 'Deployment' },
      { value: 'statefulset', label: 'StatefulSet' },
      { value: 'daemonset', label: 'DaemonSet' },
      { value: 'service', label: 'Service' },
      { value: 'configmap', label: 'ConfigMap' },
      { value: 'node', label: 'Node' },
      { value: 'namespace', label: 'Namespace' },
    ];
  }

  const inputOptions = inputs
    .filter(i => i.type === 'STRING')
    .map(i => ({
      value: `\${{ inputs.${i.key} }}`,
      label: `Input: \${{ inputs.${i.key} }} (${i.label || i.key})`,
    }));

  const custom =
    currentResource &&
    !base.some(b => b.value === currentResource.toLowerCase()) &&
    !inputOptions.some(o => o.value === currentResource)
      ? [{ value: currentResource, label: `Configured: ${currentResource}` }]
      : [];

  return [...base, ...inputOptions, ...custom];
}

export default function KubernetesActionEditor({
  config,
  errors = {},
  inputs = [],
  editorId = 'k8s',
  readOnly = false,
  onChange,
}: KubernetesActionEditorProps) {
  const action = String(config.action ?? 'get');
  const namespace = config.namespace !== undefined ? String(config.namespace) : 'default';
  const resource = String(config.resource ?? 'deployment');
  const name = String(config.name ?? '');
  const rawReplicas = config.replicas;
  const isScale = action === 'scale';
  const requiresName = ['logs', 'rollout-restart', 'rollout-status', 'scale'].includes(action);
  const resourceNameError = errors.resourceName;

  const isTemplateReplica =
    typeof rawReplicas === 'string' &&
    (rawReplicas.trim().startsWith('${{') ||
      /^\$\{\{\s*inputs\.[a-z0-9_]+\s*\}\}$/.test(rawReplicas.trim()));

  const [modeOverride, setModeOverride] = useState<'fixed' | 'input' | null>(null);
  const replicaMode = modeOverride ?? (isTemplateReplica ? 'input' : 'fixed');

  const handleActionChange = (nextAction: string) => {
    const nextConfig: Record<string, unknown> = {
      ...config,
      action: nextAction,
    };
    // Strip irrelevant fields when moving away from scale
    if (nextAction !== 'scale') {
      delete nextConfig.replicas;
    }
    // NEVER overwrite templated resources or force-rewrite without explicit user intent!
    // Preserves ${{ inputs.resource }} and allows validation to explain any concrete incompatibility.
    onChange(nextConfig);
  };

  const handleReplicasChange = (valStr: string) => {
    const nextConfig = { ...config };
    const trimmed = valStr.trim();
    if (trimmed === '') {
      // SAFE NUMERIC HANDLING: Empty string must REMOVE the key, NOT evaluate to 0!
      delete nextConfig.replicas;
    } else {
      const parsed = Number(trimmed);
      nextConfig.replicas = Number.isNaN(parsed) ? trimmed : parsed;
    }
    onChange(nextConfig);
  };

  const handleSwitchToFixed = () => {
    setModeOverride('fixed');
    const nextConfig = { ...config };
    if (typeof rawReplicas === 'string' && isTemplateReplica) {
      delete nextConfig.replicas;
    }
    onChange(nextConfig);
  };

  const handleSwitchToInput = () => {
    setModeOverride('input');
    const nextConfig = { ...config };
    if (!isTemplateReplica) {
      const defaultParam =
        inputs.find(i => i.type === 'NUMBER' || i.type === 'STRING')?.key || 'replicas';
      nextConfig.replicas = `\${{ inputs.${defaultParam} }}`;
    }
    onChange(nextConfig);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`k8s-action-${editorId}`}>Kubernetes Action</Label>
          <div className="mt-1.5">
            <FormSelect
              name={`k8s-action-${editorId}`}
              label="Action"
              value={action}
              disabled={readOnly}
              onValueChange={handleActionChange}
              options={KUBERNETES_ACTIONS}
            />
          </div>
          {errors.action && <p className="mt-1 text-xs text-destructive">{errors.action}</p>}
        </div>

        <div>
          <Label htmlFor={`k8s-namespace-${editorId}`}>Namespace</Label>
          <div className="mt-1.5">
            <Input
              id={`k8s-namespace-${editorId}`}
              aria-label="Namespace"
              placeholder="default"
              value={namespace}
              disabled={readOnly}
              onChange={e => onChange({ ...config, namespace: e.target.value })}
              className={errors.namespace ? 'border-destructive' : ''}
            />
          </div>
          {errors.namespace && <p className="mt-1 text-xs text-destructive">{errors.namespace}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`k8s-resource-${editorId}`}>Resource Type</Label>
          <div className="mt-1.5">
            <FormSelect
              name={`k8s-resource-${editorId}`}
              label="Resource type"
              value={
                resourceOptionsFor(action, inputs, resource).find(
                  o => o.value.toLowerCase() === resource.toLowerCase() || o.value === resource
                )?.value ?? resource
              }
              disabled={readOnly}
              onValueChange={(nextRes: string) => onChange({ ...config, resource: nextRes })}
              options={resourceOptionsFor(action, inputs, resource)}
            />
          </div>
          {errors.resource && <p className="mt-1 text-xs text-destructive">{errors.resource}</p>}
        </div>

        <div>
          <Label htmlFor={`k8s-name-${editorId}`}>
            Resource Name {requiresName && <span className="text-destructive">*</span>}
          </Label>
          <div className="mt-1.5">
            <Input
              id={`k8s-name-${editorId}`}
              aria-label="Resource name"
              placeholder="e.g. checkout-api"
              value={name}
              disabled={readOnly}
              onChange={e => onChange({ ...config, name: e.target.value })}
              className={resourceNameError ? 'border-destructive' : ''}
            />
          </div>
          {resourceNameError ? (
            <p className="mt-1 text-xs text-destructive">{resourceNameError}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {requiresName ? 'Name is required for this action.' : 'Optional: leave blank for all matching resources.'}
            </p>
          )}
        </div>
      </div>

      {isScale && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <Label className="font-semibold text-foreground">
                Desired Replicas <span className="text-destructive">*</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                {replicaMode === 'fixed'
                  ? 'Must be integer 0–10,000'
                  : 'Bound to a typed parameter'}
              </p>
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1 rounded-lg border bg-background/80 p-0.5">
                <Button
                  type="button"
                  variant={replicaMode === 'fixed' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] px-2 font-medium"
                  onClick={handleSwitchToFixed}
                >
                  Fixed count
                </Button>
                <Button
                  type="button"
                  variant={replicaMode === 'input' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-6 text-[11px] px-2 font-medium"
                  onClick={handleSwitchToInput}
                >
                  Typed input
                </Button>
              </div>
            )}
          </div>

          {replicaMode === 'fixed' ? (
            <div className="space-y-1.5">
              <Input
                id={`k8s-replicas-${editorId}`}
                aria-label="Desired replicas (Agent policy is authoritative)"
                type="number"
                min={0}
                max={10000}
                placeholder="e.g. 3 (leave empty while drafting; 0 is scale-to-zero)"
                value={
                  rawReplicas === undefined || rawReplicas === null || isTemplateReplica
                    ? ''
                    : String(rawReplicas)
                }
                disabled={readOnly}
                onChange={e => handleReplicasChange(e.target.value)}
                className={errors.replicas ? 'border-destructive' : ''}
              />
              {errors.replicas ? (
                <p className="text-xs font-medium text-destructive">{errors.replicas}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  ⚠️ <strong>Safe Handling:</strong> Clearing this field keeps it unconfigured. Setting explicitly to <code className="font-mono font-bold">0</code> executes a scale-to-zero shutdown.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                id={`k8s-replicas-input-${editorId}`}
                aria-label="Desired replicas input reference"
                placeholder="e.g. ${{ inputs.replicas }}"
                value={typeof rawReplicas === 'string' ? rawReplicas : ''}
                disabled={readOnly}
                onChange={e => onChange({ ...config, replicas: e.target.value })}
                className={`font-mono text-xs ${errors.replicas ? 'border-destructive' : ''}`}
              />
              {inputs.filter(i => i.type === 'NUMBER' || i.type === 'STRING').length > 0 &&
                !readOnly && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[11px] text-muted-foreground">Suggested inputs:</span>
                    {inputs
                      .filter(i => i.type === 'NUMBER' || i.type === 'STRING')
                      .map(i => {
                        const templateVal = `\${{ inputs.${i.key} }}`;
                        const isSelected = rawReplicas === templateVal;
                        return (
                          <button
                            key={i.key}
                            type="button"
                            onClick={() => onChange({ ...config, replicas: templateVal })}
                            className={`rounded px-1.5 py-0.5 font-mono text-[11px] border transition-colors ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary font-medium'
                                : 'bg-background hover:bg-muted text-foreground'
                            }`}
                          >
                            {templateVal}
                          </button>
                        );
                      })}
                  </div>
                )}
              {errors.replicas ? (
                <p className="text-xs font-medium text-destructive">{errors.replicas}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Template reference evaluated safely at execution time from resolved runbook inputs.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
