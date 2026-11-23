import type { SourceReader } from '../types';
import { alertmanager, datadog, grafana } from './core';
import { CLOUD_READERS } from './cloud';
import { TOOL_READERS } from './tools';

/**
 * Every source reader, most specific first: the first whose `detect` accepts a payload reads it. Grafana sits
 * before Alertmanager because a Grafana webhook is Alertmanager-shaped with extra fields; the batches keep their
 * own most-specific-first order.
 */
export const SOURCE_READERS: SourceReader[] = [
  grafana,
  ...CLOUD_READERS,
  ...TOOL_READERS,
  alertmanager,
  datadog,
];
