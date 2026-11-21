import { summarizeLogs } from '../normalize';
import { asArray, asRecord, httpFor, type AdapterContext, type ConnectorAdapter } from './types';

/** An Elasticsearch API key, or basic auth when a user name is stored with the password. */
function headers(context: AdapterContext): Record<string, string> {
  const { secret, secondary } = context.connection.credential;
  if (secret && secondary)
    return {
      authorization: `Basic ${Buffer.from(`${secondary}:${secret}`).toString('base64')}`,
    };
  return secret ? { authorization: `ApiKey ${secret}` } : {};
}

/** Reads an ECS field written either nested (`log: { level }`) or flat (`"log.level"`). */
const path = (record: Record<string, unknown>, dotted: string): unknown => {
  const flat = new Map(Object.entries(record)).get(dotted);
  if (flat !== undefined) return flat;
  let node: unknown = record;
  for (const key of dotted.split('.')) node = new Map(Object.entries(asRecord(node))).get(key);
  return node;
};

export const elasticAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, headers(context)).getJson('/');
  },

  async logs(context, query) {
    const index = encodeURIComponent(context.connection.project || 'logs-*').replace(/%2C/g, ',');
    const body = await httpFor(context, headers(context)).postJson(`/${index}/_search`, {
      size: query.limit,
      track_total_hits: 10_000,
      sort: [{ '@timestamp': { order: 'desc' } }],
      _source: ['@timestamp', 'message', 'log.level', 'service.name', 'host.name', 'error.message'],
      query: {
        bool: {
          must: [{ query_string: { query: query.query || '*', default_operator: 'AND' } }],
          filter: [
            {
              range: {
                '@timestamp': {
                  gte: query.window.start.toISOString(),
                  lte: query.window.end.toISOString(),
                },
              },
            },
          ],
        },
      },
    });
    const hits = asRecord(asRecord(body).hits);
    const total = asRecord(hits.total).value;
    const lines = asArray(hits.hits).map(hit => {
      const source = asRecord(asRecord(hit)._source);
      return {
        at: Date.parse(String(source['@timestamp'] ?? '')),
        text: path(source, 'message') ?? path(source, 'error.message') ?? '',
        labels: {
          level: path(source, 'log.level'),
          service: path(source, 'service.name'),
          host: path(source, 'host.name'),
        },
      };
    });
    return summarizeLogs(
      query.query,
      query.window,
      lines,
      typeof total === 'number' ? total : undefined
    );
  },
};
