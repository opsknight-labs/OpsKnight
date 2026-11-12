import { summarizeIssues } from '../normalize';
import { asArray, asRecord, bearerOrBasic, httpFor, type ConnectorAdapter } from './types';

const slug = (value: string | null) => encodeURIComponent(value ?? '');

/** Sentry issues seen in the window, most frequent first. */
export const sentryAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, bearerOrBasic(context.connection.credential)).getJson(
      `/api/0/organizations/${slug(context.connection.org)}/`
    );
  },

  async errors(context, query) {
    const { org, project } = context.connection;
    const search = [`lastSeen:>=${query.window.start.toISOString()}`, query.query ?? '']
      .join(' ')
      .trim();
    const http = httpFor(context, bearerOrBasic(context.connection.credential));
    const body = project
      ? await http.getJson(`/api/0/projects/${slug(org)}/${slug(project)}/issues/`, {
          query: { query: search, statsPeriod: '24h', sort: 'freq', limit: 10 },
        })
      : await http.getJson(`/api/0/organizations/${slug(org)}/issues/`, {
          query: {
            query: search,
            start: query.window.start.toISOString(),
            end: query.window.end.toISOString(),
            sort: 'freq',
            limit: 10,
          },
        });
    const issues = asArray(body).map(item => {
      const issue = asRecord(item);
      return {
        id: issue.shortId ?? issue.id,
        title: issue.title,
        culprit: issue.culprit,
        level: issue.level,
        status: issue.status,
        count: issue.count,
        userCount: issue.userCount,
        firstSeen: issue.firstSeen,
        lastSeen: issue.lastSeen,
        permalink: issue.permalink,
      };
    });
    return summarizeIssues(query.query ?? '', query.window, issues);
  },
};
