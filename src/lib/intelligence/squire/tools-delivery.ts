import 'server-only';
import { z } from 'zod/v4';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { AiDataClass } from '../ai/port';
import { AZURE_SEGMENT } from '../connectors/adapters/git';
import { CONNECTOR_BOUNDS, type ConnectorCapability } from '../connectors/contract';
import {
  resolveWindow,
  type ConnectorToolAdder,
  type ConnectorToolRunner,
} from './tools-observability';

/**
 * Delivery and APM reads next to the observability tools: Azure DevOps repository activity and pipeline runs,
 * Argo CD application state, and base14 Scout service KPIs and topology. Registered through
 * tools-observability.ts, so they share its connection checks, redaction and the no-MCP rule.
 */
export const DELIVERY_TOOL_DATA_CLASS: Readonly<Record<string, AiDataClass>> = {
  get_repo_activity: 'INTERNAL',
  // Build logs can echo anything a pipeline printed, customer data included.
  get_azure_pipeline_runs: 'PERSONAL',
  get_deployment_status: 'INTERNAL',
  get_apm_kpis: 'INTERNAL',
  get_service_topology: 'INTERNAL',
};

export const DELIVERY_TOOL_LABELS: Readonly<Record<string, string>> = {
  get_repo_activity: 'Reading recent commits and pull requests',
  get_azure_pipeline_runs: 'Reading pipeline runs',
  get_deployment_status: 'Reading deployment status',
  get_apm_kpis: 'Reading service KPIs',
  get_service_topology: 'Reading service topology',
};

export const DELIVERY_TOOL_CAPABILITY: Readonly<Record<string, ConnectorCapability>> = {
  get_repo_activity: 'repository',
  get_azure_pipeline_runs: 'azurePipelines',
  get_deployment_status: 'deployments',
  get_apm_kpis: 'apm',
  get_service_topology: 'apm',
};

const BRANCH = /^(?!.*\.\.)(?!\/)[A-Za-z0-9_./-]{1,200}$/;
// Kubernetes-style names: Argo CD applications and namespaces.
const K8S_NAME = /^[a-z0-9][a-z0-9.-]{0,252}$/;
const SERVICE = /^(?!.*\.\.)[A-Za-z0-9_.:/-]{1,200}$/;
const NO_PROJECT = { error: 'Give project: this connection has no default project.' };
const NOT_FOUND = { error: 'Not found, or you do not have access to it.' };

const windowFields = {
  incidentId: { type: 'string', minLength: 1, maxLength: 64 },
  start: { type: 'string', maxLength: 40, description: 'ISO 8601 date-time' },
  end: { type: 'string', maxLength: 40, description: 'ISO 8601 date-time' },
  minutes: { type: 'integer', minimum: 1, maximum: CONNECTOR_BOUNDS.maxWindowMs / 60_000 },
};
const windowInput = {
  incidentId: z.string().trim().min(1).max(64).optional(),
  start: z.iso.datetime({ offset: true }).optional(),
  end: z.iso.datetime({ offset: true }).optional(),
  minutes: z
    .number()
    .int()
    .min(1)
    .max(CONNECTOR_BOUNDS.maxWindowMs / 60_000)
    .optional(),
};

export function buildDeliveryTools(
  actor: AuthorizationActor,
  add: ConnectorToolAdder,
  run: ConnectorToolRunner
): void {
  const connectionId = z.string().trim().min(1).max(64).optional();
  const project = z.string().trim().regex(AZURE_SEGMENT).optional();
  const projectField = {
    type: 'string',
    maxLength: 100,
    description: "Azure DevOps project; defaults to the connection's project",
  };

  add(
    'get_repo_activity',
    'Recent commits and pull requests on an Azure DevOps repository branch (newest first, at most 10 each): sha, message, time; pull request title, status and source branch. Use it to see what changed before an incident.',
    {
      project: projectField,
      repository: { type: 'string', minLength: 1, maxLength: 100 },
      branch: { type: 'string', maxLength: 200, description: 'Branch name without refs/heads/' },
    },
    ['repository'],
    async input => {
      const parsed = z
        .object({
          connectionId,
          project,
          repository: z.string().trim().regex(AZURE_SEGMENT),
          branch: z.string().trim().regex(BRANCH).optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input' };
      const { repository, branch } = parsed.data;
      return run(
        'get_repo_activity',
        parsed.data.connectionId,
        'repository',
        (adapter, context) => {
          const name = parsed.data.project ?? context.connection.project;
          if (!name) return Promise.resolve(NO_PROJECT);
          return adapter.repository?.(context, { project: name, repository, branch });
        }
      );
    }
  );

  add(
    'get_azure_pipeline_runs',
    "Recent Azure Pipelines runs (newest first, at most 10) for a pipeline and/or branch: status, result, commit, times. For the newest failed run, its failed jobs and tasks with their error messages and the last 40 lines of the failing task's log.",
    {
      project: projectField,
      pipelineId: { type: 'integer', minimum: 1, description: 'Pipeline (build definition) id' },
      branch: { type: 'string', maxLength: 200, description: 'Branch name without refs/heads/' },
    },
    [],
    async input => {
      const parsed = z
        .object({
          connectionId,
          project,
          pipelineId: z.number().int().min(1).max(2_147_483_647).optional(),
          branch: z.string().trim().regex(BRANCH).optional(),
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input' };
      const { pipelineId, branch } = parsed.data;
      return run(
        'get_azure_pipeline_runs',
        parsed.data.connectionId,
        'azurePipelines',
        (adapter, context) => {
          const name = parsed.data.project ?? context.connection.project;
          if (!name) return Promise.resolve(NO_PROJECT);
          return adapter.azurePipelines?.(context, { project: name, pipelineId, branch });
        }
      );
    }
  );

  add(
    'get_deployment_status',
    'Argo CD application state. Without app: every application with its sync and health status and last deploy time. With app: sync status and revision, health, the last sync operation, the recent deploy history (revision and time) and a resource-health summary listing unhealthy or out-of-sync resources.',
    {
      app: { type: 'string', maxLength: 253, description: 'Argo CD application name' },
      appNamespace: { type: 'string', maxLength: 63 },
    },
    [],
    async input => {
      const parsed = z
        .object({
          connectionId,
          app: z.string().trim().regex(K8S_NAME).optional(),
          appNamespace: z.string().trim().max(63).regex(K8S_NAME).optional(),
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input: use an Argo CD application name.' };
      const { app, appNamespace } = parsed.data;
      return run(
        'get_deployment_status',
        parsed.data.connectionId,
        'deployments',
        (adapter, context) => adapter.deployments?.(context, { app, appNamespace })
      );
    }
  );

  add(
    'get_apm_kpis',
    'Pre-aggregated APM KPIs for one service (base14 Scout): span count, errors, error %, throughput per minute, average, p50, p95, p99 and max latency in ms. Same default window as query_metrics.',
    { service: { type: 'string', minLength: 1, maxLength: 200 }, ...windowFields },
    ['service'],
    async input => {
      const parsed = z
        .object({ connectionId, service: z.string().trim().regex(SERVICE), ...windowInput })
        .strict()
        .safeParse(input);
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      return run('get_apm_kpis', parsed.data.connectionId, 'apm', (adapter, context) =>
        adapter.apm?.(context, { view: 'kpis', service: parsed.data.service, window })
      );
    }
  );

  add(
    'get_service_topology',
    'Service map from traces (base14 Scout), at most 50 edges: with service, what that service calls and is called by; without it, the whole topology. view=services lists the active service names. Windows up to one hour (the newest hour is used).',
    {
      service: { type: 'string', maxLength: 200 },
      view: { type: 'string', enum: ['topology', 'services'], default: 'topology' },
      ...windowFields,
    },
    [],
    async input => {
      const parsed = z
        .object({
          connectionId,
          service: z.string().trim().regex(SERVICE).optional(),
          view: z.enum(['topology', 'services']).optional(),
          ...windowInput,
        })
        .strict()
        .safeParse(input ?? {});
      if (!parsed.success) return { error: 'Invalid input' };
      const window = await resolveWindow(actor, parsed.data);
      if (!window) return NOT_FOUND;
      const { service } = parsed.data;
      const view =
        parsed.data.view === 'services' ? 'services' : service ? 'dependencies' : 'topology';
      return run('get_service_topology', parsed.data.connectionId, 'apm', (adapter, context) =>
        adapter.apm?.(context, { view, service, window })
      );
    }
  );
}
