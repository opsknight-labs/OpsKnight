import { describe, expect, it } from 'vitest';
import {
  APP_ROLES,
  API_SCOPES,
  CAPABILITIES,
  getRoleCapabilities,
  hasCapability,
  isAppRole,
  isApiScope,
  isWriteApiScope,
} from '@/lib/authorization';

describe('central authorization contract', () => {
  it('recognizes only supported application roles', () => {
    expect(APP_ROLES.every(isAppRole)).toBe(true);
    expect(isAppRole('VIEWER')).toBe(false);
    expect(isAppRole(null)).toBe(false);
  });

  it('keeps administrative access exclusive to Admin', () => {
    expect(hasCapability('ADMIN', CAPABILITIES.ADMIN_MANAGE)).toBe(true);
    expect(hasCapability('RESPONDER', CAPABILITIES.ADMIN_MANAGE)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.ADMIN_MANAGE)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.ADMIN_MANAGE)).toBe(false);
  });

  it('makes Auditor organization-wide and read-only', () => {
    expect(hasCapability('AUDITOR', CAPABILITIES.INCIDENT_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.SERVICE_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.METRICS_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.SCHEDULE_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.AUDIT_READ)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.COMPLIANCE_READ)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.COMPLIANCE_EVIDENCE_READ)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.COMPLIANCE_EXPORT)).toBe(true);
    expect(hasCapability('ADMIN', CAPABILITIES.COMPLIANCE_EXPORT)).toBe(true);
    expect(hasCapability('RESPONDER', CAPABILITIES.COMPLIANCE_EXPORT)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.COMPLIANCE_EXPORT)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.INCIDENT_SENSITIVE_READ)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.POSTMORTEM_DRAFT_READ)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.OPERATIONS_MANAGE)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.ADMIN_MANAGE)).toBe(false);
  });

  it('keeps User access scoped and read-only', () => {
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_CREATE_SCOPED)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_CREATE_ALL)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_ESCALATE_SCOPED)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_NOTE_SCOPED)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.INCIDENT_NOTE_SCOPED)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_READ_SCOPED)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.SERVICE_READ_SCOPED)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_READ_ALL)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.METRICS_READ_ALL)).toBe(false);
  });

  it('does not expose global user and policy directories to scoped Users', () => {
    expect(hasCapability('ADMIN', CAPABILITIES.USER_READ_ALL)).toBe(true);
    expect(hasCapability('RESPONDER', CAPABILITIES.USER_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.USER_READ_ALL)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.USER_READ_ALL)).toBe(false);

    expect(hasCapability('ADMIN', CAPABILITIES.POLICY_READ_ALL)).toBe(true);
    expect(hasCapability('RESPONDER', CAPABILITIES.POLICY_READ_ALL)).toBe(true);
    expect(hasCapability('AUDITOR', CAPABILITIES.POLICY_READ_ALL)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.POLICY_READ_ALL)).toBe(false);
  });

  it('returns immutable copies of role grants', () => {
    const grants = getRoleCapabilities('AUDITOR');
    expect(grants).toContain(CAPABILITIES.AUDIT_READ);
    expect(getRoleCapabilities('AUDITOR')).not.toBe(grants);
  });

  it('keeps API scope validation centralized', () => {
    expect(isApiScope(API_SCOPES.INCIDENTS_READ)).toBe(true);
    expect(isApiScope('admin:write')).toBe(false);
    expect(isWriteApiScope(API_SCOPES.EVENTS_WRITE)).toBe(true);
    expect(isWriteApiScope(API_SCOPES.SERVICES_READ)).toBe(false);
  });
});
