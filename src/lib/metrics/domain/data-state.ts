export type MetricDataState = 'available' | 'partial' | 'no_data' | 'stale' | 'unavailable';
export type MetricSource = 'live' | 'rollup' | 'hybrid';
export type MetricValue<T> = {
  value: T | null;
  state: MetricDataState;
  sampleCount?: number;
  asOf: Date;
  source: MetricSource;
};
