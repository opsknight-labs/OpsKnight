import { clipText } from '../normalize';
import { asArray, asRecord, httpFor, type AdapterContext, type ConnectorAdapter } from './types';

/**
 * Argo CD API server with a read-only token (an account or project role limited to `applications, get`).
 * Squire reads application sync and health, the deploy history and a resource-health summary; deploys are
 * recorded as changes separately through the Argo CD notification webhook (/api/integrations/argocd).
 */
const APPS = 30;
const HISTORY = 10;
const UNHEALTHY = 20;

const headers = (context: AdapterContext): Record<string, string> => {
  const token = context.connection.credential.secret;
  return token ? { authorization: `Bearer ${token}` } : {};
};
const when = (value: unknown) => (typeof value === 'string' ? value : null);

export const argoCdAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, headers(context)).getJson('/api/v1/session/userinfo');
  },

  async deployments(context, query) {
    const http = httpFor(context, headers(context));
    if (!query.app) {
      const body = asRecord(
        await http.getJson('/api/v1/applications', {
          // Only the fields read below, so a large fleet stays under the response cap.
          query: {
            fields:
              'items.metadata.name,items.metadata.namespace,items.status.sync.status,items.status.sync.revision,items.status.health.status,items.status.history',
          },
        })
      );
      const items = asArray(body.items).map(asRecord);
      return {
        kind: 'deployments',
        total: items.length,
        truncated: items.length > APPS,
        applications: items.slice(0, APPS).map(item => {
          const status = asRecord(item.status);
          return {
            name: asRecord(item.metadata).name,
            namespace: asRecord(item.metadata).namespace ?? null,
            sync: asRecord(status.sync).status ?? null,
            health: asRecord(status.health).status ?? null,
            revision: String(asRecord(status.sync).revision ?? '').slice(0, 12) || null,
            lastDeployedAt: when(asArray(status.history).map(asRecord).at(-1)?.deployedAt),
          };
        }),
      };
    }
    const app = asRecord(
      await http.getJson(`/api/v1/applications/${encodeURIComponent(query.app)}`, {
        query: { appNamespace: query.appNamespace },
      })
    );
    const status = asRecord(app.status);
    const operation = asRecord(status.operationState);
    const resources = asArray(status.resources).map(asRecord);
    const byHealth: Record<string, number> = {};
    for (const resource of resources) {
      const health = String(asRecord(resource.health).status ?? 'Unknown');
      // eslint-disable-next-line security/detect-object-injection -- plain counter object built here
      byHealth[health] = (byHealth[health] ?? 0) + 1;
    }
    // Resources without a health assessment (ConfigMaps and the like) only count when out of sync.
    const unhealthy = resources.filter(resource => {
      const health = asRecord(resource.health).status;
      return resource.status === 'OutOfSync' || (health !== undefined && health !== 'Healthy');
    });
    return {
      kind: 'deployments',
      application: query.app,
      sync: {
        status: asRecord(status.sync).status ?? null,
        revision: asRecord(status.sync).revision ?? null,
      },
      health: {
        status: asRecord(status.health).status ?? null,
        message: clipText(asRecord(status.health).message, 240) || null,
      },
      lastOperation: operation.phase
        ? {
            phase: operation.phase,
            startedAt: when(operation.startedAt),
            finishedAt: when(operation.finishedAt),
            message: clipText(operation.message, 240),
          }
        : null,
      history: asArray(status.history)
        .map(asRecord)
        .slice(-HISTORY)
        .reverse()
        .map(entry => ({
          id: entry.id,
          revision: String(entry.revision ?? '').slice(0, 40),
          deployStartedAt: when(entry.deployStartedAt),
          deployedAt: when(entry.deployedAt),
        })),
      resources: {
        total: resources.length,
        byHealth,
        unhealthy: unhealthy.slice(0, UNHEALTHY).map(resource => ({
          kind: resource.kind,
          name: resource.name,
          namespace: resource.namespace ?? null,
          sync: resource.status ?? null,
          health: asRecord(resource.health).status ?? null,
          message: clipText(asRecord(resource.health).message, 160) || null,
        })),
        unhealthyTruncated: unhealthy.length > UNHEALTHY,
      },
    };
  },
};
