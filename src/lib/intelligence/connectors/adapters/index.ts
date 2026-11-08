import type { ObservabilityKind } from '../contract';
import { cloudwatchAdapter } from './cloudwatch';
import { datadogAdapter } from './datadog';
import { elasticAdapter } from './elastic';
import { githubAdapter, gitlabAdapter } from './git';
import { grafanaAdapter, lokiAdapter, prometheusAdapter, tempoAdapter } from './grafana-stack';
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
};

export type * from './types';
export { parseChangeUrl, webHostOf } from './git';
