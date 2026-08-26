/**
 * GitHub/GitLab Integration Handler
 * Transforms GitHub/GitLab webhook events to standard event format
 */

export type GitHubEvent = {
  action?: string;
  repository?: {
    name: string;
    full_name: string;
    html_url: string;
  };
  workflow_run?: {
    id: number;
    name: string;
    head_branch?: string;
    status: 'queued' | 'in_progress' | 'completed' | 'requested';
    conclusion?:
      | 'success'
      | 'failure'
      | 'neutral'
      | 'cancelled'
      | 'timed_out'
      | 'action_required'
      | 'stale'
      | 'skipped'
      | null;
    html_url: string;
  };
  check_run?: {
    id: number;
    name: string;
    status: 'queued' | 'in_progress' | 'completed';
    conclusion?:
      | 'success'
      | 'failure'
      | 'neutral'
      | 'cancelled'
      | 'timed_out'
      | 'action_required'
      | 'stale'
      | 'skipped'
      | null;
    html_url: string;
  };
  deployment?: {
    id: number;
    environment: string;
    state: 'pending' | 'success' | 'failure' | 'error';
  };
  // GitLab format
  object_kind?: string;
  project?: {
    name: string;
    path_with_namespace: string;
    web_url: string;
  };
  build_status?: string;
  status?: string;
  ref?: string;
  commit?: {
    message: string;
  };
};

export function transformGitHubToEvent(payload: GitHubEvent): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
} {
  // Handle GitHub Actions workflow_run
  if (payload.workflow_run) {
    const workflow = payload.workflow_run;
    const isFailure =
      workflow.conclusion === 'failure' ||
      workflow.conclusion === 'cancelled' ||
      workflow.conclusion === 'timed_out';
    const isResolved = workflow.status === 'completed' && workflow.conclusion === 'success';
    const isPending =
      workflow.status === 'queued' ||
      workflow.status === 'in_progress' ||
      workflow.status === 'requested';

    const repoName = payload.repository?.full_name || 'unknown';
    const branchPart = workflow.head_branch ? `-${workflow.head_branch}` : '';
    const workflowDedupKey = `github-${repoName}-${workflow.name || workflow.id}${branchPart}`
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');

    // Handle pending states as acknowledge
    if (isPending && !isFailure) {
      return {
        event_action: 'acknowledge',
        dedup_key: workflowDedupKey,
        payload: {
          summary: `Workflow in progress: ${workflow.name}`,
          source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
          severity: 'info',
          custom_details: {
            action: payload.action,
            repository: payload.repository,
            workflow_run: {
              id: workflow.id,
              name: workflow.name,
              status: workflow.status,
              conclusion: workflow.conclusion,
              html_url: workflow.html_url,
            },
          },
        },
      };
    }

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: workflowDedupKey,
      payload: {
        summary: `Workflow failed: ${workflow.name}`,
        source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
        severity: isFailure ? 'critical' : 'info',
        custom_details: {
          action: payload.action,
          repository: payload.repository,
          workflow_run: {
            id: workflow.id,
            name: workflow.name,
            status: workflow.status,
            conclusion: workflow.conclusion,
            html_url: workflow.html_url,
          },
        },
      },
    };
  }

  // Handle GitHub check_run
  if (payload.check_run) {
    const check = payload.check_run;
    const isFailure =
      check.conclusion === 'failure' ||
      check.conclusion === 'cancelled' ||
      check.conclusion === 'timed_out';
    const isResolved = check.status === 'completed' && check.conclusion === 'success';
    const isPending = check.status === 'queued' || check.status === 'in_progress';

    const repoName = payload.repository?.full_name || 'unknown';
    const checkDedupKey = `github-check-${repoName}-${check.name || check.id}`
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-');

    // Handle pending state as acknowledge
    if (isPending && !isFailure) {
      return {
        event_action: 'acknowledge',
        dedup_key: checkDedupKey,
        payload: {
          summary: `Check in progress: ${check.name}`,
          source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
          severity: 'info',
          custom_details: {
            action: payload.action,
            repository: payload.repository,
            check_run: {
              id: check.id,
              name: check.name,
              status: check.status,
              conclusion: check.conclusion,
              html_url: check.html_url,
            },
          },
        },
      };
    }

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: checkDedupKey,
      payload: {
        summary: `Check failed: ${check.name}`,
        source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
        severity: isFailure ? 'critical' : 'info',
        custom_details: {
          action: payload.action,
          repository: payload.repository,
          check_run: {
            id: check.id,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            html_url: check.html_url,
          },
        },
      },
    };
  }

  // Handle GitHub deployment
  if (payload.deployment) {
    const deployment = payload.deployment;
    const isFailure = deployment.state === 'failure' || deployment.state === 'error';
    const isResolved = deployment.state === 'success';
    const isPending = deployment.state === 'pending';

    // Handle pending state as acknowledge
    if (isPending) {
      return {
        event_action: 'acknowledge',
        dedup_key: `github-deployment-${deployment.id}`,
        payload: {
          summary: `Deployment pending: ${deployment.environment}`,
          source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
          severity: 'info',
          custom_details: {
            action: payload.action,
            repository: payload.repository,
            deployment: {
              id: deployment.id,
              environment: deployment.environment,
              state: deployment.state,
            },
          },
        },
      };
    }

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: `github-deployment-${deployment.id}`,
      payload: {
        summary: `Deployment ${deployment.state}: ${deployment.environment}`,
        source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : ''}`,
        severity: isFailure ? 'critical' : 'info',
        custom_details: {
          action: payload.action,
          repository: payload.repository,
          deployment: {
            id: deployment.id,
            environment: deployment.environment,
            state: deployment.state,
          },
        },
      },
    };
  }

  // Handle GitLab CI/CD
  if (payload.object_kind === 'build' || payload.build_status) {
    const isFailure = payload.build_status === 'failed' || payload.status === 'failed';
    const isResolved = payload.build_status === 'success' || payload.status === 'success';

    // For GitLab, pending states are handled as acknowledge
    const isPending = !isResolved && !isFailure;
    const project = payload.project?.path_with_namespace || 'unknown';
    const ref = payload.ref ? `-${payload.ref}` : '';
    const gitlabDedupKey = `gitlab-${project}${ref}`.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    if (isPending) {
      return {
        event_action: 'acknowledge',
        dedup_key: gitlabDedupKey,
        payload: {
          summary: `Build ${payload.build_status || payload.status}: ${payload.ref || 'unknown'}`,
          source: `GitLab${payload.project ? ` - ${payload.project.path_with_namespace}` : ''}`,
          severity: 'info',
          custom_details: {
            object_kind: payload.object_kind,
            project: payload.project,
            build_status: payload.build_status,
            status: payload.status,
            ref: payload.ref,
            commit: payload.commit,
          },
        },
      };
    }

    return {
      event_action: isResolved ? 'resolve' : 'trigger',
      dedup_key: gitlabDedupKey,
      payload: {
        summary: `Build ${payload.build_status || payload.status}: ${payload.ref || 'unknown'}`,
        source: `GitLab${payload.project ? ` - ${payload.project.path_with_namespace}` : ''}`,
        severity: isFailure ? 'error' : 'info',
        custom_details: {
          object_kind: payload.object_kind,
          project: payload.project,
          build_status: payload.build_status,
          status: payload.status,
          ref: payload.ref,
          commit: payload.commit,
        },
      },
    };
  }

  // Fallback for unsupported event types - return acknowledge instead of throwing
  // This handles events like push, pull_request, issues, etc. that we don't process
  // Use repo/project name for stable dedup key (avoids Date.now() which defeats dedup)
  return {
    event_action: 'acknowledge',
    dedup_key: `github-unknown-${payload.repository?.full_name || payload.project?.path_with_namespace || 'fallback'}`,
    payload: {
      summary: `GitHub event received: ${payload.action || payload.object_kind || 'unknown'}`,
      source: `GitHub${payload.repository ? ` - ${payload.repository.full_name}` : payload.project ? ` - ${payload.project.path_with_namespace}` : ''}`,
      severity: 'info',
      custom_details: payload,
    },
  };
}
