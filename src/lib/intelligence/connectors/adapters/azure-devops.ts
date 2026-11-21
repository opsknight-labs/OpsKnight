import { ConnectorError } from '../http';
import { clipText, summarizeDiff } from '../normalize';
import {
  asArray,
  asRecord,
  httpFor,
  type AdapterContext,
  type ConnectorAdapter,
  type AzurePipelineQuery,
  type RepositoryQuery,
} from './types';

/**
 * Azure DevOps Services (https://dev.azure.com/<org>) and Azure DevOps Server
 * (https://<host>/<collection path>): the base URL is the organization or collection. A PAT with read-only
 * Code and Build scopes, sent as Basic auth with an empty user name. api-version 6.0 is served by both.
 */
const API_VERSION = '6.0';
const RUNS = 10;
const ITEMS = 10;
const FAILED_RECORDS = 5;
const LOG_LINES = 40;
const FILES = 30;

function headers(context: AdapterContext): Record<string, string> {
  const pat = context.connection.credential.secret;
  return pat ? { authorization: `Basic ${Buffer.from(`:${pat}`).toString('base64')}` } : {};
}

const seg = (value: string) => encodeURIComponent(value);
const when = (value: unknown) => (typeof value === 'string' ? value : null);
const branchRef = (branch?: string) => (branch ? `refs/heads/${branch}` : undefined);

function changeFiles(entries: unknown) {
  return asArray(entries)
    .slice(0, FILES)
    .map(item => {
      const entry = asRecord(item);
      const type = String(entry.changeType ?? 'edit');
      return {
        path: asRecord(entry.item).path,
        status: type.includes('add')
          ? 'added'
          : type.includes('delete')
            ? 'removed'
            : type.includes('rename')
              ? 'renamed'
              : 'modified',
      };
    });
}

async function repository(context: AdapterContext, query: RepositoryQuery) {
  const http = httpFor(context, headers(context));
  const repo = `/${seg(query.project)}/_apis/git/repositories/${seg(query.repository)}`;
  const [commits, pulls] = await Promise.all([
    http.getJson(`${repo}/commits`, {
      query: {
        'searchCriteria.itemVersion.version': query.branch,
        'searchCriteria.$top': ITEMS,
        'api-version': API_VERSION,
      },
    }),
    http.getJson(`${repo}/pullrequests`, {
      query: {
        'searchCriteria.status': 'all',
        'searchCriteria.targetRefName': branchRef(query.branch),
        $top: ITEMS,
        'api-version': API_VERSION,
      },
    }),
  ]);
  return {
    kind: 'repository',
    project: query.project,
    repository: query.repository,
    branch: query.branch ?? null,
    commits: asArray(asRecord(commits).value)
      .slice(0, ITEMS)
      .map(item => {
        const commit = asRecord(item);
        return {
          sha: String(commit.commitId ?? '').slice(0, 12),
          message: clipText(commit.comment, 200),
          at: when(asRecord(commit.committer).date),
          url: when(commit.remoteUrl),
        };
      }),
    pullRequests: asArray(asRecord(pulls).value)
      .slice(0, ITEMS)
      .map(item => {
        const pull = asRecord(item);
        return {
          id: pull.pullRequestId,
          title: clipText(pull.title, 200),
          status: pull.status,
          mergeStatus: pull.mergeStatus ?? null,
          sourceBranch: when(pull.sourceRefName),
          createdAt: when(pull.creationDate),
          closedAt: when(pull.closedDate),
        };
      }),
  };
}

async function pipelines(context: AdapterContext, query: AzurePipelineQuery) {
  const http = httpFor(context, headers(context));
  const build = `/${seg(query.project)}/_apis/build/builds`;
  const body = await http.getJson(build, {
    query: {
      definitions: query.pipelineId,
      branchName: branchRef(query.branch),
      $top: RUNS,
      queryOrder: 'finishTimeDescending',
      'api-version': API_VERSION,
    },
  });
  const runs = asArray(asRecord(body).value)
    .slice(0, RUNS)
    .map(item => {
      const run = asRecord(item);
      return {
        id: Number(run.id),
        number: run.buildNumber,
        pipeline: asRecord(run.definition).name,
        status: run.status,
        result: run.result ?? null,
        branch: when(run.sourceBranch),
        commit: String(run.sourceVersion ?? '').slice(0, 12) || null,
        startedAt: when(run.startTime),
        finishedAt: when(run.finishTime),
        url: when(asRecord(asRecord(run._links).web).href),
      };
    });
  const failed = runs.find(run => run.result === 'failed' && Number.isInteger(run.id));
  if (!failed) return { kind: 'pipelines', project: query.project, runs, failure: null };

  const timeline = await http.getJson(`${build}/${failed.id}/timeline`, {
    query: { 'api-version': API_VERSION },
  });
  const records = asArray(asRecord(timeline).records)
    .map(asRecord)
    .filter(record => record.result === 'failed')
    .slice(0, FAILED_RECORDS);
  // The log of the deepest failed record (a task) says the most; fall back to any failed record's log.
  const logged = [...records].reverse().find(record => Number.isInteger(asRecord(record.log).id));
  let logTail: string[] = [];
  let logTruncated = false;
  if (logged) {
    const log = await http.getJson(
      `${build}/${failed.id}/logs/${Number(asRecord(logged.log).id)}`,
      {
        query: { 'api-version': API_VERSION },
      }
    );
    const lines = asArray(asRecord(log).value).map(line => clipText(line, 240));
    logTruncated = lines.length > LOG_LINES;
    logTail = lines.slice(-LOG_LINES);
  }
  return {
    kind: 'pipelines',
    project: query.project,
    runs,
    failure: {
      runId: failed.id,
      records: records.map(record => ({
        type: record.type,
        name: clipText(record.name, 120),
        issues: asArray(record.issues)
          .slice(0, 3)
          .map(issue => clipText(asRecord(issue).message, 240)),
      })),
      logTail,
      logTruncated,
    },
  };
}

export const azureDevOpsAdapter: ConnectorAdapter = {
  async test(context) {
    await httpFor(context, headers(context)).getJson('/_apis/projects', {
      query: { $top: 1, 'api-version': API_VERSION },
    });
  },

  repository,
  azurePipelines: pipelines,

  async diff(context, ref) {
    if (ref.provider !== 'azure')
      throw new ConnectorError('UNSUPPORTED', 'Not an Azure DevOps change URL');
    const [project, repo] = ref.repository.split('/');
    const http = httpFor(context, headers(context));
    const base = `/${seg(project)}/_apis/git/repositories/${seg(repo)}`;
    const query = { 'api-version': API_VERSION };
    if (ref.type === 'commit') {
      const commit = asRecord(
        await http.getJson(`${base}/commits/${ref.id}`, { query: { ...query, changeCount: FILES } })
      );
      return summarizeDiff({
        provider: 'azure',
        ref: String(commit.commitId ?? ref.id).slice(0, 12),
        title: String(commit.comment ?? '').split('\n')[0],
        url: ref.url,
        files: changeFiles(asRecord(commit.changes).changes ?? commit.changes),
      });
    }
    const [pull, iterations] = await Promise.all([
      http.getJson(`${base}/pullrequests/${ref.id}`, { query }),
      http.getJson(`${base}/pullrequests/${ref.id}/iterations`, { query }),
    ]);
    const last = asArray(asRecord(iterations).value).map(asRecord).at(-1);
    const changes =
      last && Number.isInteger(last.id)
        ? await http.getJson(
            `${base}/pullrequests/${ref.id}/iterations/${Number(last.id)}/changes`,
            {
              query: { ...query, $top: FILES },
            }
          )
        : {};
    return summarizeDiff({
      provider: 'azure',
      ref: `!${ref.id}`,
      title: asRecord(pull).title,
      url: ref.url,
      files: changeFiles(asRecord(changes).changeEntries),
    });
  },
};
