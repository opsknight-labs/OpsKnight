import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  mapGitHubDeploymentChange,
  mapGitLabDeploymentChange,
  mapKubernetesRolloutChange,
} from '@/lib/intelligence/changes/deploy-mappers';
import { verifyWebhookSignature } from '@/lib/integrations/signature-verification';

// Trimmed from GitHub's documented `deployment_status` webhook (X-GitHub-Event: deployment_status).
const githubDeploymentStatus = {
  action: 'created',
  deployment_status: {
    id: 2_947_116_042,
    state: 'success',
    description: 'Deployment finished successfully.',
    environment: 'production',
    target_url: 'https://github.com/acme/checkout/actions/runs/6743212345',
    log_url: 'https://github.com/acme/checkout/actions/runs/6743212345/job/18330299311',
    created_at: '2026-11-20T09:14:51Z',
    updated_at: '2026-11-20T09:14:51Z',
    creator: { login: 'github-actions[bot]', type: 'Bot' },
  },
  deployment: {
    id: 1_195_473_215,
    sha: '9f1c2d3e4b5a69788796a5b4c3d2e1f0a9b8c7d6',
    ref: 'main',
    task: 'deploy',
    environment: 'production',
    original_environment: 'production',
    production_environment: true,
    created_at: '2026-11-20T09:11:02Z',
    updated_at: '2026-11-20T09:14:51Z',
    creator: { login: 'octocat', type: 'User' },
  },
  repository: {
    id: 123456789,
    name: 'checkout',
    full_name: 'acme/checkout',
    html_url: 'https://github.com/acme/checkout',
  },
  sender: { login: 'github-actions[bot]' },
};

// Trimmed from GitLab's documented deployment event (X-Gitlab-Event: Deployment Hook).
const gitlabDeployment = {
  object_kind: 'deployment',
  status: 'success',
  status_changed_at: '2026-11-20 10:50:00 +0100',
  deployment_id: 15,
  deployable_id: 796,
  deployable_url: 'https://gitlab.example.com/shop/payments/-/jobs/796',
  environment: 'production',
  environment_tier: 'production',
  environment_slug: 'production',
  environment_external_url: 'https://payments.example.com',
  project: {
    id: 30,
    name: 'payments',
    path_with_namespace: 'shop/payments',
    web_url: 'https://gitlab.example.com/shop/payments',
  },
  short_sha: '279484c0',
  user: { id: 1, name: 'Administrator', username: 'root' },
  user_url: 'https://gitlab.example.com/root',
  commit_url:
    'https://gitlab.example.com/shop/payments/-/commit/279484c09fbe69ededfced8c1bb6e6d24616b468',
  commit_title: 'Add retry to the card authoriser',
  ref: 'main',
};

// A core/v1 Event about an Argo Rollouts Rollout as kubernetes-event-exporter forwards it to a webhook.
const rolloutEvent = {
  metadata: {
    name: 'cart.17f9a2b3c4d5e6f7',
    namespace: 'shop',
    uid: '6f0c3a52-8a1e-4b1f-9b55-7f5f2b3f4e21',
    creationTimestamp: '2026-11-20T08:00:41Z',
  },
  reason: 'RolloutCompleted',
  message: 'Rollout completed update to revision 7 (6d8c9f7b5d): Completed all 4 canary steps',
  source: { component: 'rollouts-controller' },
  firstTimestamp: '2026-11-20T08:00:41Z',
  lastTimestamp: '2026-11-20T08:00:41Z',
  count: 1,
  type: 'Normal',
  clusterName: 'prod-eu-1',
  involvedObject: {
    kind: 'Rollout',
    namespace: 'shop',
    name: 'cart',
    uid: 'c1d2e3f4-0000-4a4a-9b9b-123456789abc',
    apiVersion: 'argoproj.io/v1alpha1',
    labels: { 'app.kubernetes.io/name': 'cart-api', environment: 'prod' },
    annotations: { 'rollout.argoproj.io/revision': '7' },
  },
};

describe('deploy change-source mappers', () => {
  it('records a finished GitHub deployment with its start time', () => {
    expect(mapGitHubDeploymentChange(githubDeploymentStatus)).toMatchObject({
      source: 'github',
      kind: 'DEPLOY',
      component: 'checkout',
      version: '9f1c2d3e4b5a69788796a5b4c3d2e1f0a9b8c7d6',
      dedupKey: 'acme/checkout:1195473215',
      occurredAt: '2026-11-20T09:14:51Z',
      url: 'https://github.com/acme/checkout/actions/runs/6743212345',
      labels: {
        repository: 'acme/checkout',
        environment: 'production',
        state: 'success',
        ref: 'main',
        startedAt: '2026-11-20T09:11:02Z',
      },
    });
    const inProgress = structuredClone(githubDeploymentStatus);
    inProgress.deployment_status.state = 'in_progress';
    expect(mapGitHubDeploymentChange(inProgress)).toBeNull();
    // A bare deployment event (created, no outcome yet) is left to its statuses.
    const { deployment, repository } = githubDeploymentStatus;
    expect(mapGitHubDeploymentChange({ action: 'created', deployment, repository })).toBeNull();
    expect(mapGitHubDeploymentChange({})).toBeNull();
  });

  it('records finished GitLab deployments and normalises GitLab time stamps', () => {
    expect(mapGitLabDeploymentChange(gitlabDeployment)).toMatchObject({
      source: 'gitlab',
      kind: 'DEPLOY',
      component: 'payments',
      version: '279484c0',
      dedupKey: 'shop/payments:15:success',
      occurredAt: '2026-11-20T10:50:00+01:00',
      labels: { project: 'shop/payments', environment: 'production', actor: 'root' },
    });
    expect(
      mapGitLabDeploymentChange({
        ...gitlabDeployment,
        status_changed_at: '2026-11-20 09:50:00 UTC',
      })?.occurredAt
    ).toBe('2026-11-20T09:50:00Z');
    expect(mapGitLabDeploymentChange({ ...gitlabDeployment, status: 'running' })).toBeNull();
    expect(mapGitLabDeploymentChange({ ...gitlabDeployment, object_kind: 'push' })).toBeNull();
  });

  it('records completed and aborted Kubernetes rollouts by their app label', () => {
    expect(mapKubernetesRolloutChange(rolloutEvent)).toMatchObject({
      source: 'kubernetes',
      kind: 'DEPLOY',
      component: 'cart-api',
      version: '7',
      dedupKey: 'shop/cart:7:RolloutCompleted',
      occurredAt: '2026-11-20T08:00:41Z',
      labels: {
        namespace: 'shop',
        workload: 'Rollout/cart',
        cluster: 'prod-eu-1',
        environment: 'prod',
        app: 'cart-api',
      },
    });
    expect(
      mapKubernetesRolloutChange({ ...rolloutEvent, reason: 'RolloutAborted' })?.summary
    ).toContain('aborted');
    expect(mapKubernetesRolloutChange({ ...rolloutEvent, reason: 'RolloutStepCompleted' })).toBe(
      null
    );
  });

  it('verifies the GitHub HMAC and the GitLab token the routes are configured with', () => {
    const raw = JSON.stringify(githubDeploymentStatus);
    const signature = `sha256=${crypto.createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
    expect(
      verifyWebhookSignature('github', raw, { 'x-hub-signature-256': signature }, 's3cret')
    ).toMatchObject({ valid: true });
    expect(
      verifyWebhookSignature('github', `${raw} `, { 'x-hub-signature-256': signature }, 's3cret')
        .valid
    ).toBe(false);
    expect(
      verifyWebhookSignature('gitlab', '{}', { 'x-gitlab-token': 's3cret' }, 's3cret').valid
    ).toBe(true);
    expect(
      verifyWebhookSignature('gitlab', '{}', { 'x-gitlab-token': 'nope' }, 's3cret').valid
    ).toBe(false);
  });
});
