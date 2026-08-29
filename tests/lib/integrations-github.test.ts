import { describe, it, expect } from 'vitest';
import { transformGitHubToEvent, type GitHubEvent } from '@/lib/integrations/github';

describe('GitHub & GitLab Integration Event Transformation (Industry Standard)', () => {
  describe('GitHub workflow_run', () => {
    it('triggers an incident on workflow failure', () => {
      const payload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_run: {
          id: 12345,
          name: 'CI Tests',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/12345',
        },
      };

      const event = transformGitHubToEvent(payload);
      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.payload.summary).toBe('Workflow failed: CI Tests');
      expect(event.dedup_key).toBe('github-opsknight-labs-opsknight-ci-tests-main');
    });

    it('triggers an incident on timed_out and cancelled workflow runs', () => {
      const timedOutPayload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_run: {
          id: 12346,
          name: 'Deploy Staging',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'timed_out',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/12346',
        },
      };

      const event = transformGitHubToEvent(timedOutPayload);
      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
    });

    it('auto-resolves an incident on workflow success', () => {
      const payload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_run: {
          id: 12347,
          name: 'CI Tests',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/12347',
        },
      };

      const event = transformGitHubToEvent(payload);
      expect(event.event_action).toBe('resolve');
      expect(event.payload.severity).toBe('info');
      expect(event.payload.summary).toBe('Workflow succeeded: CI Tests');
      expect(event.dedup_key).toBe('github-opsknight-labs-opsknight-ci-tests-main');
    });

    it('acknowledges (does NOT trigger) skipped or neutral workflows', () => {
      const skippedPayload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_run: {
          id: 12348,
          name: 'Nightly Benchmarks',
          head_branch: 'feat/test',
          status: 'completed',
          conclusion: 'skipped',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/12348',
        },
      };

      const event = transformGitHubToEvent(skippedPayload);
      expect(event.event_action).toBe('acknowledge');
      expect(event.payload.severity).toBe('info');
      expect(event.payload.summary).toBe('Workflow skipped: Nightly Benchmarks');
    });

    it('acknowledges (does NOT trigger) in_progress or queued workflows', () => {
      const inProgressPayload: GitHubEvent = {
        action: 'in_progress',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_run: {
          id: 12349,
          name: 'CI Build',
          head_branch: 'main',
          status: 'in_progress',
          conclusion: null,
          html_url: 'https://github.com/opsknight-labs/OpsKnight/actions/runs/12349',
        },
      };

      const event = transformGitHubToEvent(inProgressPayload);
      expect(event.event_action).toBe('acknowledge');
      expect(event.payload.severity).toBe('info');
      expect(event.payload.summary).toBe('Workflow in progress: CI Build');
    });
  });

  describe('GitHub check_run', () => {
    it('triggers an incident on check failure', () => {
      const payload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        check_run: {
          id: 991,
          name: 'typecheck',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/runs/991',
        },
      };

      const event = transformGitHubToEvent(payload);
      expect(event.event_action).toBe('trigger');
      expect(event.payload.severity).toBe('critical');
      expect(event.payload.summary).toBe('Check failed: typecheck');
    });

    it('auto-resolves an incident on check success', () => {
      const payload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        check_run: {
          id: 992,
          name: 'typecheck',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/runs/992',
        },
      };

      const event = transformGitHubToEvent(payload);
      expect(event.event_action).toBe('resolve');
      expect(event.payload.summary).toBe('Check succeeded: typecheck');
    });

    it('acknowledges (does NOT trigger) skipped checks', () => {
      const payload: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        check_run: {
          id: 993,
          name: 'DAST (OWASP ZAP)',
          status: 'completed',
          conclusion: 'skipped',
          html_url: 'https://github.com/opsknight-labs/OpsKnight/runs/993',
        },
      };

      const event = transformGitHubToEvent(payload);
      expect(event.event_action).toBe('acknowledge');
      expect(event.payload.summary).toBe('Check skipped: DAST (OWASP ZAP)');
    });
  });

  describe('GitHub workflow_job', () => {
    it('handles individual job failures, successes, and skips', () => {
      const failJob: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_job: {
          id: 501,
          name: 'build',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'failure',
        },
      };

      const passJob: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_job: {
          id: 502,
          name: 'build',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
        },
      };

      const skippedJob: GitHubEvent = {
        action: 'completed',
        repository: {
          name: 'OpsKnight',
          full_name: 'opsknight-labs/OpsKnight',
          html_url: 'https://github.com/opsknight-labs/OpsKnight',
        },
        workflow_job: {
          id: 503,
          name: 'release-quality',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'skipped',
        },
      };

      expect(transformGitHubToEvent(failJob).event_action).toBe('trigger');
      expect(transformGitHubToEvent(passJob).event_action).toBe('resolve');
      expect(transformGitHubToEvent(skippedJob).event_action).toBe('acknowledge');
    });
  });
});
