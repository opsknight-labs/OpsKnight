import { normalizeEventAction, normalizeSeverity, firstString } from './normalization';
import type { VercelPayload } from './schemas';

export function transformVercelToEvent(data: VercelPayload): {
  event_action: 'trigger' | 'resolve' | 'acknowledge';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    custom_details: Record<string, unknown>;
  };
} {
  const eventType = (data.type || '').toLowerCase();
  const projectName =
    firstString(data.payload?.project?.name, data.payload?.deployment?.name, data.payload?.name) ||
    'vercel-project';
  const target = data.payload?.target || 'production';
  const isProduction = target === 'production';
  const deploymentId = data.payload?.deployment?.id;

  // Default to acknowledge + info — only known error events should trigger incidents
  let event_action: 'trigger' | 'resolve' | 'acknowledge' = 'acknowledge';
  let severity: 'critical' | 'error' | 'warning' | 'info' = 'info';
  let summary = `Vercel: ${eventType || 'event'} on ${projectName} (${target})`;

  if (eventType.includes('deployment.error') || eventType.includes('deployment.failed')) {
    event_action = 'trigger';
    severity = isProduction ? 'critical' : 'error';
    const errMessage =
      data.payload?.error?.message || data.payload?.error?.code || 'Build or Runtime Error';
    summary = `Vercel: Deployment failed for ${projectName} (${target}) - ${errMessage}`;
  } else if (eventType.includes('deployment.canceled')) {
    event_action = 'acknowledge';
    severity = 'warning';
    summary = `Vercel: Deployment canceled for ${projectName} (${target})`;
  } else if (eventType.includes('deployment.succeeded') || eventType.includes('deployment.ready')) {
    event_action = 'resolve';
    severity = 'info';
    summary = `Vercel: Deployment succeeded for ${projectName} (${target})`;
  } else if (eventType.includes('deployment.created')) {
    // Informational — a new deployment was initiated, not an error
    event_action = 'acknowledge';
    severity = 'info';
    summary = `Vercel: Deployment started for ${projectName} (${target})`;
  }

  // For production, use project+target as dedup key (all deployments resolve each other)
  // For preview/development, include deployment ID to prevent different PRs from clobbering
  const dedup_key = isProduction
    ? `vercel-${projectName.toLowerCase()}-production`
    : `vercel-${projectName.toLowerCase()}-${target.toLowerCase()}-${deploymentId || 'unknown'}`;

  return {
    event_action,
    dedup_key,
    payload: {
      summary,
      source: 'Vercel',
      severity,
      custom_details: {
        eventType: data.type,
        project: projectName,
        target,
        deploymentId,
        deploymentUrl: data.payload?.deployment?.url,
        error: data.payload?.error,
        user: data.payload?.user?.username,
        team: data.payload?.team?.slug,
        meta: data.payload?.deployment?.meta,
        raw: data,
      },
    },
  };
}
