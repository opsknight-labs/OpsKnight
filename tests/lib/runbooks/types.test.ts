import { describe, it, expect } from 'vitest';
import {
  isTerminalVersionState,
  isIncidentTriggerEvent,
  isTerminalExecutionStatus,
  isActiveExecutionStatus,
  isTerminalStepStatus,
  isTerminalAttemptStatus,
  isAgentAvailable,
  requiresAgent,
  isSafeToRetryAfterUnknown,
  isRetryable,
  RUNBOOK_VERSION_STATES,
  RUNBOOK_BINDING_MODES,
  RUNBOOK_VERSION_STRATEGIES,
  RUNBOOK_TRIGGER_EVENTS,
  RUNBOOK_EXECUTION_STATUSES,
  TERMINAL_EXECUTION_STATUSES,
  RUNBOOK_STEP_TYPES,
  LOCAL_STEP_TYPES,
  RUNBOOK_RISK_CLASSES,
  RUNBOOK_STEP_STATUSES,
  TERMINAL_STEP_STATUSES,
  RUNBOOK_ATTEMPT_STATUSES,
  TERMINAL_ATTEMPT_STATUSES,
  RUNBOOK_AGENT_STATUSES,
  RUNBOOK_AGENT_POOL_MODES,
  RUNBOOK_CONDITION_OPERATORS,
  RUNBOOK_INPUT_TYPES,
  RUNBOOK_TRIGGER_BY_TYPES,
  RUNBOOK_CONDITION_LOGICS,
  RUNBOOK_JOB_KINDS,
} from '@/lib/runbooks/types';

describe('Runbook Type Guards and Utilities', () => {
  describe('isTerminalVersionState', () => {
    it('returns true for RETIRED', () => {
      expect(isTerminalVersionState('RETIRED')).toBe(true);
    });
    it('returns false for other states', () => {
      expect(isTerminalVersionState('DRAFT')).toBe(false);
      expect(isTerminalVersionState('PUBLISHED')).toBe(false);
    });
  });

  describe('isIncidentTriggerEvent', () => {
    it('returns true for incident events', () => {
      expect(isIncidentTriggerEvent('INCIDENT_CREATED')).toBe(true);
      expect(isIncidentTriggerEvent('INCIDENT_UPDATED')).toBe(true);
      expect(isIncidentTriggerEvent('URGENCY_CHANGED')).toBe(true);
      expect(isIncidentTriggerEvent('STATUS_CHANGED')).toBe(true);
    });
    it('returns false for non-incident events', () => {
      expect(isIncidentTriggerEvent('ALERT_RECEIVED')).toBe(false);
      expect(isIncidentTriggerEvent('MANUAL')).toBe(false);
      expect(isIncidentTriggerEvent('API')).toBe(false);
      expect(isIncidentTriggerEvent('CHATOPS')).toBe(false);
      expect(isIncidentTriggerEvent('SCHEDULED')).toBe(false);
    });
  });

  describe('isTerminalExecutionStatus & isActiveExecutionStatus', () => {
    const terminalStatuses = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'] as const;
    const activeStatuses = [
      'QUEUED',
      'RUNNING',
      'WAITING_AGENT',
      'WAITING_APPROVAL',
      'PAUSED',
      'CANCEL_REQUESTED',
    ] as const;

    it('identifies terminal statuses correctly', () => {
      terminalStatuses.forEach(status => {
        expect(isTerminalExecutionStatus(status)).toBe(true);
        expect(isActiveExecutionStatus(status)).toBe(false);
      });
    });

    it('identifies active statuses correctly', () => {
      activeStatuses.forEach(status => {
        expect(isTerminalExecutionStatus(status)).toBe(false);
        expect(isActiveExecutionStatus(status)).toBe(true);
      });
    });
  });

  describe('isTerminalStepStatus', () => {
    const terminal = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED'];
    it('identifies terminal step statuses', () => {
      RUNBOOK_STEP_STATUSES.forEach(status => {
        if (terminal.includes(status)) {
          expect(isTerminalStepStatus(status)).toBe(true);
        } else {
          expect(isTerminalStepStatus(status)).toBe(false);
        }
      });
    });
  });

  describe('isTerminalAttemptStatus', () => {
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'UNKNOWN'];
    it('identifies terminal attempt statuses', () => {
      RUNBOOK_ATTEMPT_STATUSES.forEach(status => {
        if (terminal.includes(status)) {
          expect(isTerminalAttemptStatus(status)).toBe(true);
        } else {
          expect(isTerminalAttemptStatus(status)).toBe(false);
        }
      });
    });
  });

  describe('isAgentAvailable', () => {
    const available = ['ONLINE', 'DEGRADED'];
    it('identifies available agent statuses', () => {
      RUNBOOK_AGENT_STATUSES.forEach(status => {
        if (available.includes(status)) {
          expect(isAgentAvailable(status)).toBe(true);
        } else {
          expect(isAgentAvailable(status)).toBe(false);
        }
      });
    });
  });

  describe('requiresAgent', () => {
    const local = ['MANUAL', 'APPROVAL', 'CONDITION', 'WAIT', 'HTTP'];
    it('identifies step types requiring an agent', () => {
      RUNBOOK_STEP_TYPES.forEach(type => {
        if (local.includes(type)) {
          expect(requiresAgent(type)).toBe(false);
        } else {
          expect(requiresAgent(type)).toBe(true);
        }
      });
    });
  });

  describe('isSafeToRetryAfterUnknown', () => {
    it('returns true for READ_ONLY', () => {
      expect(isSafeToRetryAfterUnknown('READ_ONLY')).toBe(true);
    });
    it('returns false for others', () => {
      expect(isSafeToRetryAfterUnknown('IDEMPOTENT_WRITE')).toBe(false);
      expect(isSafeToRetryAfterUnknown('NON_IDEMPOTENT')).toBe(false);
    });
  });

  describe('isRetryable', () => {
    it('returns false for NON_IDEMPOTENT', () => {
      expect(isRetryable('NON_IDEMPOTENT')).toBe(false);
    });
    it('returns true for others', () => {
      expect(isRetryable('READ_ONLY')).toBe(true);
      expect(isRetryable('IDEMPOTENT_WRITE')).toBe(true);
    });
  });
});

describe('Runbook Constants', () => {
  it('has expected RUNBOOK_VERSION_STATES', () => {
    expect(RUNBOOK_VERSION_STATES).toEqual(['DRAFT', 'PUBLISHED', 'RETIRED']);
  });

  it('has expected RUNBOOK_BINDING_MODES', () => {
    expect(RUNBOOK_BINDING_MODES).toEqual(['MANUAL', 'SUGGESTED', 'AUTOMATIC']);
  });

  it('has expected RUNBOOK_VERSION_STRATEGIES', () => {
    expect(RUNBOOK_VERSION_STRATEGIES).toEqual(['PINNED', 'LATEST_PUBLISHED']);
  });

  it('has expected TERMINAL_EXECUTION_STATUSES', () => {
    expect(Array.from(TERMINAL_EXECUTION_STATUSES)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
    ]);
  });

  it('has expected LOCAL_STEP_TYPES', () => {
    expect(Array.from(LOCAL_STEP_TYPES)).toEqual([
      'MANUAL',
      'APPROVAL',
      'CONDITION',
      'WAIT',
      'HTTP',
    ]);
  });

  it('has expected TERMINAL_STEP_STATUSES', () => {
    expect(Array.from(TERMINAL_STEP_STATUSES)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'SKIPPED',
      'CANCELLED',
    ]);
  });

  it('has expected TERMINAL_ATTEMPT_STATUSES', () => {
    expect(Array.from(TERMINAL_ATTEMPT_STATUSES)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'CANCELLED',
      'TIMED_OUT',
      'UNKNOWN',
    ]);
  });

  it('validates lengths of other constants arrays', () => {
    expect(RUNBOOK_TRIGGER_EVENTS.length).toBeGreaterThan(0);
    expect(RUNBOOK_EXECUTION_STATUSES.length).toBeGreaterThan(0);
    expect(RUNBOOK_STEP_TYPES.length).toBeGreaterThan(0);
    expect(RUNBOOK_RISK_CLASSES.length).toBeGreaterThan(0);
    expect(RUNBOOK_STEP_STATUSES.length).toBeGreaterThan(0);
    expect(RUNBOOK_ATTEMPT_STATUSES.length).toBeGreaterThan(0);
    expect(RUNBOOK_AGENT_STATUSES.length).toBeGreaterThan(0);
    expect(RUNBOOK_AGENT_POOL_MODES.length).toBeGreaterThan(0);
    expect(RUNBOOK_CONDITION_OPERATORS.length).toBeGreaterThan(0);
    expect(RUNBOOK_INPUT_TYPES.length).toBeGreaterThan(0);
    expect(RUNBOOK_TRIGGER_BY_TYPES.length).toBeGreaterThan(0);
    expect(RUNBOOK_CONDITION_LOGICS.length).toBeGreaterThan(0);
    expect(RUNBOOK_JOB_KINDS.length).toBeGreaterThan(0);
  });
});
