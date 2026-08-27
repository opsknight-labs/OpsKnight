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
    expect(hasCapability('AUDITOR', CAPABILITIES.INCIDENT_SENSITIVE_READ)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.POSTMORTEM_DRAFT_READ)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.OPERATIONS_MANAGE)).toBe(false);
    expect(hasCapability('AUDITOR', CAPABILITIES.ADMIN_MANAGE)).toBe(false);
  });

  it('keeps User access scoped', () => {
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_CREATE_SCOPED)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_CREATE_ALL)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_READ_SCOPED)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.SERVICE_READ_SCOPED)).toBe(true);
    expect(hasCapability('USER', CAPABILITIES.INCIDENT_READ_ALL)).toBe(false);
    expect(hasCapability('USER', CAPABILITIES.METRICS_READ_ALL)).toBe(false);
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
