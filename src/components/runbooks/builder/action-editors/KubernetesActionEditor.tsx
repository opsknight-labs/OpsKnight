'use client';

import { Label } from '@/components/ui/shadcn/label';
import { Input } from '@/components/ui/shadcn/input';
import { FormSelect } from '../../RunbookControls';
import type { RunbookInputInput } from '@/lib/runbooks/schemas';

interface KubernetesActionEditorProps {
  config: Record<string, unknown>;
  errors?: Record<string, string>;
  inputs: RunbookInputInput[];
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

function resourceOptionsFor(action: string) {
  if (['rollout-restart', 'rollout-status'].includes(action)) {
    return [
      { value: 'deployment', label: 'Deployment' },
      { value: 'daemonset', label: 'DaemonSet' },
      { value: 'statefulset', label: 'StatefulSet' },
    ];
  }
  if (action === 'scale') {
    return [
      { value: 'deployment', label: 'Deployment' },
      { value: 'statefulset', label: 'StatefulSet' },
      { value: 'replicaset', label: 'ReplicaSet' },
      { value: 'replicationcontroller', label: 'ReplicationController' },
    ];
  }
  if (action === 'logs') {
    return [
      { value: 'pod', label: 'Pod' },
      { value: 'deployment', label: 'Deployment' },
      { value: 'daemonset', label: 'DaemonSet' },
      { value: 'statefulset', label: 'StatefulSet' },
    ];
  }
  return [
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

export default function KubernetesActionEditor({
  config,
  errors = {},
  readOnly = false,
  onChange,
}: KubernetesActionEditorProps) {
  const action = String(config.action ?? 'get');
  const namespace = String(config.namespace ?? 'default');
  const resource = String(config.resource ?? 'deployment');
  const name = String(config.name ?? '');
  const rawReplicas = config.replicas;
  const isScale = action === 'scale';
  const requiresName = ['logs', 'rollout-restart', 'rollout-status', 'scale'].includes(action);

  const handleActionChange = (nextAction: string) => {
    const nextConfig: Record<string, unknown> = {
      ...config,
      action: nextAction,
    };
    // Strip irrelevant fields when moving away from scale
    if (nextAction !== 'scale') {
      delete nextConfig.replicas;
    }
    // Adjust resource default if current resource is incompatible with nextAction
    const validResources = resourceOptionsFor(nextAction).map(r => r.value);
    if (!validResources.includes(resource.toLowerCase()) && validResources.length > 0) {
      nextConfig.resource = validResources[0];
    }
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="k8s-action">Kubernetes Action</Label>
          <div className="mt-1.5">
            <FormSelect
              name="k8s-action"
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
          <Label htmlFor="k8s-namespace">Namespace</Label>
          <div className="mt-1.5">
            <Input
              id="k8s-namespace"
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
          <Label htmlFor="k8s-resource">Resource Type</Label>
          <div className="mt-1.5">
            <FormSelect
              name="k8s-resource"
              label="Resource type"
              value={resource.toLowerCase()}
              disabled={readOnly}
              onValueChange={(nextRes: string) => onChange({ ...config, resource: nextRes })}
              options={resourceOptionsFor(action)}
            />
          </div>
          {errors.resource && <p className="mt-1 text-xs text-destructive">{errors.resource}</p>}
        </div>

        <div>
          <Label htmlFor="k8s-name">
            Resource Name {requiresName && <span className="text-destructive">*</span>}
          </Label>
          <div className="mt-1.5">
            <Input
              id="k8s-name"
              aria-label="Resource name"
              placeholder="e.g. checkout-api"
              value={name}
              disabled={readOnly}
              onChange={e => onChange({ ...config, name: e.target.value })}
              className={errors.name ? 'border-destructive' : ''}
            />
          </div>
          {errors.name ? (
            <p className="mt-1 text-xs text-destructive">{errors.name}</p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              {requiresName ? 'Name is required for this action.' : 'Optional: leave blank for all matching resources.'}
            </p>
          )}
        </div>
      </div>

      {isScale && (
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="k8s-replicas" className="font-semibold text-foreground">
              Desired Replicas <span className="text-destructive">*</span>
            </Label>
            <span className="text-xs text-muted-foreground">Must be integer 0–10,000</span>
          </div>
          <Input
            id="k8s-replicas"
            aria-label="Desired replicas (Agent policy is authoritative)"
            type="number"
            min={0}
            max={10000}
            placeholder="e.g. 3 (leave empty while drafting; 0 is scale-to-zero)"
            value={rawReplicas === undefined || rawReplicas === null ? '' : String(rawReplicas)}
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
      )}
    </div>
  );
}
