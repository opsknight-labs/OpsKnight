import { createHash, createHmac } from 'node:crypto';
import { ConnectorError } from '../http';
import { summarizeLogs, summarizeSeries, type RawSeries } from '../normalize';
import {
  asArray,
  asRecord,
  autoStep,
  httpFor,
  seconds,
  type AdapterContext,
  type ConnectorAdapter,
  type MetricsQuery,
} from './types';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key: Buffer | string, value: string) =>
  createHmac('sha256', key).update(value, 'utf8').digest();

/**
 * AWS Signature Version 4 for the JSON protocol: the request is signed over its host, content type, target
 * and date headers and the exact body. Pure and deterministic for a given clock, so it is unit-tested.
 */
export function signAwsRequest(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now?: Date;
}): Record<string, string> {
  const service = input.url.hostname.split('.')[0];
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const signed: Record<string, string> = {
    'content-type': input.headers['content-type'] ?? '',
    host: input.url.host,
    'x-amz-date': amzDate,
    ...(input.headers['x-amz-target'] ? { 'x-amz-target': input.headers['x-amz-target'] } : {}),
  };
  const names = Object.keys(signed).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .sort()
    .join('&');
  const canonical = [
    input.method,
    input.url.pathname || '/',
    query,
    // eslint-disable-next-line security/detect-object-injection -- names are the fixed keys of `signed`
    names.map(name => `${name}:${signed[name].trim()}\n`).join(''),
    names.join(';'),
    sha256(input.body),
  ].join('\n');
  const scope = `${date}/${input.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), service),
    'aws4_request'
  );
  const signature = createHmac('sha256', key).update(toSign, 'utf8').digest('hex');
  return {
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}

function client(context: AdapterContext) {
  const { region, credential } = context.connection;
  if (!region || !credential.secret || !credential.secondary)
    throw new ConnectorError('UNSUPPORTED', 'CloudWatch needs a region and access keys');
  return httpFor(
    context,
    {},
    {
      sign: request =>
        signAwsRequest({
          ...request,
          region,
          accessKeyId: credential.secondary!,
          secretAccessKey: credential.secret!,
        }),
    }
  );
}

const logsUrl = (region: string) => `https://logs.${region}.amazonaws.com/`;
const METRICS_TARGET = 'GraniteServiceVersion20100801';

async function cloudwatchSeries(
  context: AdapterContext,
  query: MetricsQuery
): Promise<RawSeries[]> {
  const body = await client(context).postJson(
    '/',
    {
      MetricDataQueries: [
        { Id: 'q1', Expression: query.query, Period: autoStep(query.window, query.stepSeconds) },
      ],
      StartTime: seconds(query.window.start),
      EndTime: seconds(query.window.end),
      ScanBy: 'TimestampAscending',
      MaxDatapoints: 5_000,
    },
    {
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': `${METRICS_TARGET}.GetMetricData`,
      },
    }
  );
  const series = asArray(asRecord(body).MetricDataResults).map(item => {
    const result = asRecord(item);
    const timestamps = asArray(result.Timestamps);
    const values = asArray(result.Values);
    return {
      labels: { label: result.Label, id: result.Id },
      points: timestamps.flatMap((at, index) => {
        const time = typeof at === 'number' ? at * 1000 : Date.parse(String(at));
        // eslint-disable-next-line security/detect-object-injection -- index of a parallel array
        const value = Number(values[index]);
        return Number.isFinite(time) && Number.isFinite(value)
          ? [[time, value] as [number, number]]
          : [];
      }),
    };
  });
  return series;
}

export const cloudwatchAdapter: ConnectorAdapter = {
  async test(context) {
    await client(context).postJson(
      '/',
      { Namespace: 'AWS/Usage', RecentlyActive: 'PT3H' },
      {
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': `${METRICS_TARGET}.ListMetrics`,
        },
      }
    );
  },

  /** A Metrics Insights query or a metric-math SEARCH expression, through GetMetricData. */
  async metrics(context, query) {
    return summarizeSeries(query.query, query.window, await cloudwatchSeries(context, query));
  },

  series: (context, query) => cloudwatchSeries(context, query),

  /** A filter pattern over the log group saved on the connection. */
  async logs(context, query) {
    const group = context.connection.project;
    if (!group)
      throw new ConnectorError('UNSUPPORTED', 'Set the log group on the connection to search logs');
    const body = await client(context).postJson(
      '/',
      {
        logGroupName: group,
        filterPattern: query.query,
        startTime: query.window.start.getTime(),
        endTime: query.window.end.getTime(),
        limit: query.limit,
      },
      {
        absoluteUrl: logsUrl(context.connection.region!),
        headers: {
          'content-type': 'application/x-amz-json-1.1',
          'x-amz-target': 'Logs_20140328.FilterLogEvents',
        },
      }
    );
    const lines = asArray(asRecord(body).events).map(item => {
      const event = asRecord(item);
      return {
        at: Number(event.timestamp),
        text: event.message,
        labels: { stream: event.logStreamName },
      };
    });
    return summarizeLogs(query.query, query.window, lines);
  },
};
