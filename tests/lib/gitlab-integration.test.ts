import { describe, it, expect } from 'vitest';
import { transformGitLabToEvent } from '@/lib/integrations/gitlab';
import { GitLabPayloadSchema, validatePayload } from '@/lib/integrations/schemas';
import { verifyGitLabToken } from '@/lib/integrations/signature-verification';

describe('GitLab Webhooks Integration', () => {
  it('should parse a pipeline failure event and trigger incident', () => {
    const payload = {
      object_kind: 'pipeline',
      project: {
        id: 42,
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
        web_url: 'https://gitlab.com/fintech/payment-service',
      },
      object_attributes: {
        id: 991,
        ref: 'main',
        status: 'failed',
      },
      ref: 'main',
      status: 'failed',
      commit: {
        id: 'abc1234',
        message: 'fix: payment retry exponential backoff',
        author: { name: 'Dev Engineer', email: 'dev@company.com' },
      },
    };

    const validation = validatePayload(GitLabPayloadSchema, payload);
    expect(validation.success).toBe(true);

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('trigger');
    expect(event.payload.severity).toBe('error');
    // Ensure pipeline ID is in the dedup key to avoid collissions with other pipelines on the same branch
    expect(event.dedup_key).toBe('gitlab-fintech-payment-service-pipeline-991');
    expect(event.payload.custom_details.sha).toBe('abc1234');
  });

  it('should parse a pipeline success event and resolve prior failure with matching dedup key', () => {
    const payload = {
      object_kind: 'pipeline',
      project: {
        id: 42,
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
      },
      object_attributes: {
        id: 992,
        ref: 'main',
        status: 'success',
      },
      ref: 'main',
      status: 'success',
    };

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('resolve');
    expect(event.dedup_key).toBe('gitlab-fintech-payment-service-pipeline-992');
  });

  it('should parse a merge request open event as acknowledge', () => {
    const payload = {
      object_kind: 'merge_request',
      project: {
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
      },
      object_attributes: {
        id: 55,
        iid: 12,
        title: 'Add new payment gateway',
        action: 'open',
        source_branch: 'feature-123',
        target_branch: 'main',
      },
    };

    const validation = validatePayload(GitLabPayloadSchema, payload);
    expect(validation.success).toBe(true);

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('acknowledge');
    expect(event.payload.severity).toBe('info');
    expect(event.dedup_key).toBe('gitlab-fintech-payment-service-mr-12');
  });

  it('should parse a merge request merge event as resolve', () => {
    const payload = {
      object_kind: 'merge_request',
      project: {
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
      },
      object_attributes: {
        iid: 12,
        title: 'Add new payment gateway',
        action: 'merge',
      },
    };

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('resolve');
    expect(event.dedup_key).toBe('gitlab-fintech-payment-service-mr-12');
  });

  it('should parse a deployment failure event as trigger', () => {
    const payload = {
      object_kind: 'deployment',
      project: {
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
      },
      environment: 'production',
      status: 'failed',
    };

    const validation = validatePayload(GitLabPayloadSchema, payload);
    expect(validation.success).toBe(true);

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('trigger');
    expect(event.payload.severity).toBe('error');
    expect(event.dedup_key).toBe('gitlab-fintech-payment-service-deploy-production');
  });

  it('should parse unknown events as acknowledge to avoid incident noise', () => {
    const payload = {
      object_kind: 'push',
      project: {
        name: 'payment-service',
        path_with_namespace: 'fintech/payment-service',
      },
      ref: 'refs/heads/main',
    };

    const event = transformGitLabToEvent(payload as any);
    expect(event.event_action).toBe('acknowledge');
    expect(event.payload.severity).toBe('info');
  });

  it('should verify X-Gitlab-Token correctly', () => {
    const secret = 'gl-secret-token-123';
    expect(verifyGitLabToken('gl-secret-token-123', secret)).toBe(true);
    expect(verifyGitLabToken('wrong-token', secret)).toBe(false);
  });
});
