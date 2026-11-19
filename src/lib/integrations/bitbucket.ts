import { normalizeSeverity, firstString } from './normalization';

export type BitbucketEvent = {
  event?: string;
  repository?: {
    name?: string;
    full_name?: string;
    uuid?: string;
    links?: {
      html?: { href?: string };
    };
  };
  pipeline?: {
    uuid?: string;
    build_number?: number;
    state?: {
      name?: string;
      result?: { name?: string };
    };
  };
  commit_status?: {
    name?: string;
    state?: string;
    description?: string;
    url?: string;
  };
  status?: string;
  [key: string]: unknown;
};

// Only an explicit failure pages and only an explicit success recovers; push,
// PR and in-progress/stopped events are informational.
function determineAction(
  ...states: Array<string | undefined>
): 'trigger' | 'resolve' | 'acknowledge' {
  const normalized = states.filter(Boolean).join(' ').toLowerCase();
  if (/\b(failed|error)\b/.test(normalized)) return 'trigger';
  if (/\b(successful|success)\b/.test(normalized)) return 'resolve';
  return 'acknowledge';
}

export function transformBitbucketToEvent(data: BitbucketEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const pipelineState = data.pipeline?.state?.name;
  const pipelineResult = data.pipeline?.state?.result?.name;
  const commitState = data.commit_status?.state;
  const summary =
    firstString(data.repository?.full_name, data.repository?.name) || 'Bitbucket Pipeline';

  const action = determineAction(commitState, pipelineResult, pipelineState);
  const severity = normalizeSeverity(action === 'trigger' ? 'error' : 'info', 'error');

  // Use stable repository + pipeline/commit status name for dedup key across runs
  const repoName = (data.repository?.full_name || data.repository?.name || 'unknown')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 100);
  const statusName = data.commit_status?.name
    ? `-${data.commit_status.name.replace(/\s+/g, '-').toLowerCase().slice(0, 50)}`
    : '';
  const dedupKey = `bitbucket-${repoName}${statusName}`;

  return {
    event_action: action,
    dedup_key: String(dedupKey),
    payload: {
      summary: `Bitbucket ${commitState || pipelineResult || pipelineState || 'pipeline'}: ${summary}`,
      source: 'Bitbucket',
      severity,
      custom_details: {
        event: data.event,
        pipeline: data.pipeline,
        commitStatus: data.commit_status,
        repository: data.repository,
        raw: data,
      },
    },
  };
}
