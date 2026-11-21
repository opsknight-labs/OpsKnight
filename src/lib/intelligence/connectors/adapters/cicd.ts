import { ConnectorError } from '../http';
import { githubAdapter, gitlabAdapter } from './git';
import { asArray, asRecord, httpFor, type AdapterContext, type ConnectorAdapter } from './types';

/*
 * Read-only CI/CD: recent GitHub Actions workflow runs / GitLab CI pipelines for a repository, and for one run
 * its failed jobs with a short tail. Same credentials and test read as the git connectors.
 */

export const PIPELINE_LIMITS = {
  runs: 10,
  failedJobs: 5,
  tailLines: 30,
  tailChars: 4_000,
} as const;

const FAILED = new Set(['failure', 'failed', 'timed_out', 'startup_failure']);
// ANSI colour codes and GitLab collapsible-section markers.
const NOISE = /\u001b\[[0-9;]*[A-Za-z]|section_(start|end):\d+:[^\r\n]*?\r?(\u001b\[0K)?/g;

const str = (value: unknown, max = 200) => {
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The last lines of a log, cleaned and bounded. Exported for tests. */
export function logTail(raw: string): string {
  const lines = raw
    .replace(NOISE, '')
    .split(/\r?\n/)
    .filter(line => line.trim());
  const tail = lines.slice(-PIPELINE_LIMITS.tailLines).join('\n');
  return tail.length > PIPELINE_LIMITS.tailChars
    ? `…${tail.slice(-(PIPELINE_LIMITS.tailChars - 1))}`
    : tail;
}

function githubHeaders(context: AdapterContext): Record<string, string> {
  const secret = context.connection.credential.secret;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

const githubRun = (item: unknown) => {
  const run = asRecord(item);
  return {
    id: str(run.id, 30),
    name: str(run.name ?? run.display_title),
    branch: str(run.head_branch),
    sha: str(run.head_sha, 40).slice(0, 12),
    event: str(run.event, 40),
    status: str(run.status, 40),
    conclusion: str(run.conclusion, 40) || null,
    startedAt: str(run.run_started_at ?? run.created_at, 40) || null,
    updatedAt: str(run.updated_at, 40) || null,
    url: str(run.html_url, 500),
  };
};

export const githubActionsAdapter: ConnectorAdapter = {
  test: githubAdapter.test,

  async pipelines(context, query) {
    const http = httpFor(context, githubHeaders(context));
    const repo = `/repos/${query.repository.split('/').map(encodeURIComponent).join('/')}`;
    if (!query.runId) {
      const body = asRecord(
        await http.getJson(`${repo}/actions/runs`, {
          query: { branch: query.branch, per_page: PIPELINE_LIMITS.runs },
        })
      );
      return {
        provider: 'github_actions',
        repository: query.repository,
        runs: asArray(body.workflow_runs).slice(0, PIPELINE_LIMITS.runs).map(githubRun),
      };
    }
    const [run, jobs] = await Promise.all([
      http.getJson(`${repo}/actions/runs/${query.runId}`),
      http.getJson(`${repo}/actions/runs/${query.runId}/jobs`, {
        query: { filter: 'latest', per_page: 50 },
      }),
    ]);
    const failed = asArray(asRecord(jobs).jobs)
      .map(asRecord)
      .filter(job => FAILED.has(String(job.conclusion)));
    // shortcut: GitHub serves raw job logs only via a redirect to blob storage, which the guarded fetch refuses;
    // the check-run annotations (the job id is its check-run id) carry the error lines instead.
    const failedJobs = await Promise.all(
      failed.slice(0, PIPELINE_LIMITS.failedJobs).map(async job => {
        const annotations = await http
          .getJson(`${repo}/check-runs/${encodeURIComponent(str(job.id, 30))}/annotations`, {
            query: { per_page: 20 },
          })
          .catch(() => []);
        return {
          id: str(job.id, 30),
          name: str(job.name),
          conclusion: str(job.conclusion, 40),
          failedSteps: asArray(job.steps)
            .map(asRecord)
            .filter(step => FAILED.has(String(step.conclusion)))
            .map(step => str(step.name)),
          url: str(job.html_url, 500),
          logTail: logTail(
            asArray(annotations)
              .map(asRecord)
              .map(
                note => `${str(note.path)}:${str(note.start_line, 10)} ${str(note.message, 500)}`
              )
              .join('\n')
          ),
        };
      })
    );
    return {
      provider: 'github_actions',
      repository: query.repository,
      runs: [githubRun(run)],
      failedJobs,
      truncated: { failedJobs: failed.length > failedJobs.length },
    };
  },
};

function gitlabHeaders(context: AdapterContext): Record<string, string> {
  const secret = context.connection.credential.secret;
  return secret ? { 'private-token': secret } : {};
}

const gitlabRun = (item: unknown) => {
  const run = asRecord(item);
  return {
    id: str(run.id, 30),
    name: str(run.name ?? `pipeline ${str(run.iid, 20)}`),
    branch: str(run.ref),
    sha: str(run.sha, 40).slice(0, 12),
    event: str(run.source, 40),
    status: str(run.status, 40),
    conclusion: null,
    startedAt: str(run.started_at ?? run.created_at, 40) || null,
    updatedAt: str(run.updated_at, 40) || null,
    url: str(run.web_url, 500),
  };
};

export const gitlabCiAdapter: ConnectorAdapter = {
  test: gitlabAdapter.test,

  async pipelines(context, query) {
    const http = httpFor(context, gitlabHeaders(context));
    const project = `/api/v4/projects/${encodeURIComponent(query.repository)}`;
    if (!query.runId) {
      const body = await http.getJson(`${project}/pipelines`, {
        query: { ref: query.branch, per_page: PIPELINE_LIMITS.runs, order_by: 'id', sort: 'desc' },
      });
      return {
        provider: 'gitlab_ci',
        repository: query.repository,
        runs: asArray(body).slice(0, PIPELINE_LIMITS.runs).map(gitlabRun),
      };
    }
    const [run, jobs] = await Promise.all([
      http.getJson(`${project}/pipelines/${query.runId}`),
      http.getJson(`${project}/pipelines/${query.runId}/jobs`, {
        query: { 'scope[]': 'failed', per_page: 50 },
      }),
    ]);
    const failed = asArray(jobs)
      .map(asRecord)
      .filter(job => FAILED.has(String(job.status)));
    const failedJobs = await Promise.all(
      failed.slice(0, PIPELINE_LIMITS.failedJobs).map(async job => {
        const trace = await http
          .getText(`${project}/jobs/${encodeURIComponent(str(job.id, 30))}/trace`, {
            headers: { accept: 'text/plain' },
          })
          .then(logTail)
          .catch((error: unknown) =>
            error instanceof ConnectorError && error.code === 'TOO_LARGE'
              ? '(log too large to read; open the job)'
              : ''
          );
        return {
          id: str(job.id, 30),
          name: str(job.name),
          conclusion: str(job.status, 40),
          failedSteps: [str(job.stage), str(job.failure_reason)].filter(Boolean),
          url: str(job.web_url, 500),
          logTail: trace,
        };
      })
    );
    return {
      provider: 'gitlab_ci',
      repository: query.repository,
      runs: [gitlabRun(run)],
      failedJobs,
      truncated: { failedJobs: failed.length > failedJobs.length },
    };
  },
};
