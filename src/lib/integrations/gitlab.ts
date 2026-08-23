import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';
import type { GitLabPayload } from './schemas';

export function transformGitLabToEvent(data: GitLabPayload): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const kind = (data.object_kind || data.event_type || 'pipeline').toLowerCase();
  const projectPath =
    firstString(data.project?.path_with_namespace, data.project?.name) || 'gitlab-project';
  const cleanProject = projectPath.replace(/\//g, '-').replace(/\s+/g, '-').toLowerCase();

  // 1. Pipeline / Build / Job Webhooks
  if (kind === 'pipeline' || kind === 'build' || kind === 'job') {
    const rawStatus =
      firstString(data.build_status, data.status, data.object_attributes?.status) || 'unknown';
    const status = rawStatus.toLowerCase();
    const ref = firstString(data.ref, 'main');
    const pipelineId = data.object_attributes?.id || data.build_id;

    let event_action: 'trigger' | 'resolve' | 'acknowledge' = 'trigger';
    let severity: 'critical' | 'error' | 'warning' | 'info' = 'error';

    if (status === 'success' || status === 'passed' || status === 'manual') {
      event_action = 'resolve';
      severity = 'info';
    } else if (
      status === 'running' ||
      status === 'pending' ||
      status === 'created' ||
      status === 'preparing' ||
      status === 'waiting_for_resource'
    ) {
      event_action = 'acknowledge';
      severity = 'info';
    } else if (status === 'failed') {
      event_action = 'trigger';
      severity = 'error';
    } else if (status === 'canceled' || status === 'skipped') {
      event_action = 'acknowledge';
      severity = 'warning';
    }

    const summary = `GitLab CI: Pipeline for ${projectPath} on ${ref} ${rawStatus}`;
    // Include pipeline ID in dedup key so different pipelines don't collide, with ref fallback
    const dedup_key = pipelineId
      ? `gitlab-${cleanProject}-pipeline-${pipelineId}`
      : `gitlab-${cleanProject}-${ref}`;

    return {
      event_action,
      dedup_key,
      payload: {
        summary,
        source: 'GitLab CI',
        severity,
        custom_details: {
          project: projectPath,
          ref,
          status: rawStatus,
          pipelineId,
          sha: data.sha || data.commit?.id,
          commitMessage: data.commit?.message || data.commit?.title,
          author: data.commit?.author?.name || data.user?.name,
          buildName: data.build_name,
          buildStage: data.build_stage,
          webUrl: data.project?.web_url,
          raw: data,
        },
      },
    };
  }

  // 2. Merge Request Webhooks
  if (kind === 'merge_request') {
    const action = firstString(
      data.object_attributes?.action,
      data.object_attributes?.state
    )?.toLowerCase();
    const mrTitle = firstString(data.object_attributes?.title) || 'Merge Request';
    const mrIid = data.object_attributes?.iid || data.object_attributes?.id;
    const sourceBranch = data.object_attributes?.source_branch;
    const targetBranch = data.object_attributes?.target_branch;

    let event_action: 'trigger' | 'resolve' | 'acknowledge' = 'acknowledge';
    if (action === 'merge' || action === 'merged' || action === 'close' || action === 'closed') {
      event_action = 'resolve';
    } else if (
      action === 'open' ||
      action === 'opened' ||
      action === 'reopen' ||
      action === 'reopened'
    ) {
      event_action = 'acknowledge';
    }

    const dedup_key = `gitlab-${cleanProject}-mr-${mrIid || 'unknown'}`;

    return {
      event_action,
      dedup_key,
      payload: {
        summary: `GitLab MR: ${mrTitle} (${sourceBranch || '?'} → ${targetBranch || '?'})`,
        source: 'GitLab',
        severity: 'info',
        custom_details: {
          project: projectPath,
          mrIid,
          title: data.object_attributes?.title,
          action,
          sourceBranch,
          targetBranch,
          url: data.object_attributes?.url,
          author: data.user?.name,
          raw: data,
        },
      },
    };
  }

  // 3. Deployment Webhooks
  if (kind === 'deployment') {
    const deployStatus = firstString(
      data.deployment_status,
      data.status,
      data.object_attributes?.status
    )?.toLowerCase();
    const environment = firstString(data.environment, 'unknown');

    let event_action: 'trigger' | 'resolve' | 'acknowledge' = 'acknowledge';
    let severity: 'critical' | 'error' | 'warning' | 'info' = 'info';

    if (deployStatus === 'failed') {
      event_action = 'trigger';
      severity = 'error';
    } else if (deployStatus === 'success' || deployStatus === 'created') {
      event_action = 'resolve';
      severity = 'info';
    } else if (deployStatus === 'canceled') {
      event_action = 'acknowledge';
      severity = 'warning';
    }

    const dedup_key = `gitlab-${cleanProject}-deploy-${environment}`;

    return {
      event_action,
      dedup_key,
      payload: {
        summary: `GitLab Deploy: ${projectPath} to ${environment} ${deployStatus || 'unknown'}`,
        source: 'GitLab',
        severity,
        custom_details: {
          project: projectPath,
          environment,
          status: deployStatus,
          url: data.object_attributes?.url,
          author: data.user?.name,
          raw: data,
        },
      },
    };
  }

  // 4. Issues / Incidents / Alerts
  if (kind === 'issue' || kind === 'incident' || kind === 'alert') {
    const action = firstString(
      data.object_attributes?.action,
      data.object_attributes?.state
    )?.toLowerCase();
    const issueTitle =
      firstString(data.object_attributes?.title, data.object_attributes?.description) ||
      'GitLab Alert';
    const issueId = data.object_attributes?.id || 'alert';

    let event_action: 'trigger' | 'resolve' | 'acknowledge' = 'trigger';
    if (action === 'close' || action === 'closed' || action === 'resolved') {
      event_action = 'resolve';
    } else if (action === 'reopen' || action === 'open' || action === 'opened') {
      event_action = 'trigger';
    }

    const severity = normalizeSeverity(data.object_attributes?.severity, 'error');
    const dedup_key = `gitlab-${cleanProject}-issue-${issueId}`;

    return {
      event_action,
      dedup_key,
      payload: {
        summary: `GitLab: ${issueTitle}`,
        source: 'GitLab',
        severity,
        custom_details: {
          project: projectPath,
          issueId,
          title: data.object_attributes?.title,
          description: data.object_attributes?.description,
          url: data.object_attributes?.url,
          raw: data,
        },
      },
    };
  }

  // Default fallback: acknowledge unknown event types (push, tag_push, note, wiki_page, etc.)
  // to log them without creating noise
  const summary = `GitLab Webhook: ${projectPath} ${kind}`;
  const dedup_key = `gitlab-${cleanProject}-${kind}`;

  return {
    event_action: 'acknowledge',
    dedup_key,
    payload: {
      summary,
      source: 'GitLab',
      severity: 'info',
      custom_details: {
        kind,
        project: projectPath,
        raw: data,
      },
    },
  };
}
