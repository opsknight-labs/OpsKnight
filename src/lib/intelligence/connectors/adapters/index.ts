import type { ObservabilityKind } from '../contract';
import { githubActionsAdapter, gitlabCiAdapter } from './cicd';
import { argoCdAdapter } from './argocd';
import { azureDevOpsAdapter } from './azure-devops';
import { base14Adapter } from './base14';
import { cloudwatchAdapter } from './cloudwatch';
import { datadogAdapter } from './datadog';
import { elasticAdapter } from './elastic';
import { githubAdapter, gitlabAdapter } from './git';
import { grafanaAdapter, lokiAdapter, prometheusAdapter, tempoAdapter } from './grafana-stack';
import { kubernetesAdapter } from './kubernetes';
import { sentryAdapter } from './sentry';
import type { ConnectorAdapter } from './types';

export const CONNECTOR_ADAPTERS: Readonly<Record<ObservabilityKind, ConnectorAdapter>> = {
  PROMETHEUS: prometheusAdapter,
  LOKI: lokiAdapter,
  TEMPO: tempoAdapter,
  GRAFANA: grafanaAdapter,
  DATADOG: datadogAdapter,
  ELASTIC: elasticAdapter,
  CLOUDWATCH: cloudwatchAdapter,
  SENTRY: sentryAdapter,
  GITHUB: githubAdapter,
  GITLAB: gitlabAdapter,
  KUBERNETES: kubernetesAdapter,
  GITHUB_ACTIONS: githubActionsAdapter,
  GITLAB_CI: gitlabCiAdapter,
  AZURE_DEVOPS: azureDevOpsAdapter,
  ARGOCD: argoCdAdapter,
  BASE14_SCOUT: base14Adapter,
};

export type * from './types';
export { parseChangeUrl, webHostOf } from './git';
