import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { transformVercelToEvent } from '@/lib/integrations/vercel';
import { VercelPayloadSchema, validatePayload } from '@/lib/integrations/schemas';
import { verifyVercelSignature } from '@/lib/integrations/signature-verification';

describe('Vercel Webhooks Integration', () => {
  it('should parse deployment.error on production as critical trigger', () => {
    const payload = {
      id: 'evt_12345',
      type: 'deployment.error',
      createdAt: 1786962000000,
      payload: {
        deployment: {
          id: 'dpl_abc123',
          name: 'frontend-app',
          url: 'frontend-app-prod.vercel.app',
        },
        project: {
          id: 'prj_xyz789',
          name: 'frontend-app',
        },
        target: 'production',
        error: {
          code: 'BUILD_FAILED',
          message: 'Command "npm run build" exited with 1',
        },
        user: {
          username: 'deployer',
        },
      },
    };

    const validation = validatePayload(VercelPayloadSchema, payload);
    expect(validation.success).toBe(true);

    const event = transformVercelToEvent(payload as any);
    expect(event.event_action).toBe('trigger');
    expect(event.payload.severity).toBe('critical');
    // Production deployments use a general dedup key so subsequent deploys resolve it
    expect(event.dedup_key).toBe('vercel-frontend-app-production');
    expect(event.payload.summary).toContain('Deployment failed');
  });

  it('should parse deployment.succeeded and resolve prior failure on same target', () => {
    const payload = {
      id: 'evt_12346',
      type: 'deployment.succeeded',
      payload: {
        project: {
          name: 'frontend-app',
        },
        target: 'production',
      },
    };

    const event = transformVercelToEvent(payload as any);
    expect(event.event_action).toBe('resolve');
    expect(event.dedup_key).toBe('vercel-frontend-app-production');
  });

  it('should parse deployment.error on preview with deployment ID in dedup key', () => {
    const payload = {
      id: 'evt_12347',
      type: 'deployment.error',
      payload: {
        deployment: {
          id: 'dpl_preview999',
          name: 'frontend-app',
        },
        target: 'preview',
      },
    };

    const event = transformVercelToEvent(payload as any);
    expect(event.event_action).toBe('trigger');
    expect(event.payload.severity).toBe('error'); // preview is error, not critical
    // Preview uses deployment ID so different PRs don't clobber each other
    expect(event.dedup_key).toBe('vercel-frontend-app-preview-dpl_preview999');
  });

  it('should parse deployment.created as acknowledge (informational)', () => {
    const payload = {
      id: 'evt_12348',
      type: 'deployment.created',
      payload: {
        project: { name: 'frontend-app' },
        target: 'production',
      },
    };

    const event = transformVercelToEvent(payload as any);
    expect(event.event_action).toBe('acknowledge');
    expect(event.payload.severity).toBe('info');
  });

  it('should verify Vercel HMAC-SHA1 signatures in x-vercel-signature', () => {
    const secret = 'vercel-webhook-secret-999';
    const body = JSON.stringify({ type: 'deployment.error', id: 'evt_1' });

    const expectedSig = crypto.createHmac('sha1', secret).update(body).digest('hex');
    expect(verifyVercelSignature(body, expectedSig, secret)).toBe(true);
    expect(verifyVercelSignature(body, 'wrong-signature', secret)).toBe(false);
  });
});
