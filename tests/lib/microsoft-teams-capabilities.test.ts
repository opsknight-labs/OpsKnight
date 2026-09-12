import { describe, it, expect } from 'vitest';
import { categorizeTeamsErrorCode } from '@/lib/microsoft-teams/capabilities';
import { MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS } from '@/lib/microsoft-teams/app-manifest';

describe('categorizeTeamsErrorCode', () => {
  it('maps known provider error codes to failure codes', () => {
    expect(categorizeTeamsErrorCode('NOT_CONFIGURED')).toBe('NOT_CONFIGURED');
    expect(categorizeTeamsErrorCode('TENANT_REQUIRED')).toBe('TENANT_REQUIRED');
    expect(categorizeTeamsErrorCode('GRAPH_TOKEN_FAILED')).toBe('GRAPH_TOKEN_FAILED');
    expect(categorizeTeamsErrorCode('RATE_LIMITED')).toBe('RATE_LIMITED');
    expect(categorizeTeamsErrorCode('CHANNEL_NOT_FOUND')).toBe('CHANNEL_NOT_FOUND');
    expect(categorizeTeamsErrorCode('MESSAGE_NOT_FOUND')).toBe('MESSAGE_NOT_FOUND');
    expect(categorizeTeamsErrorCode('DESTINATION_NOT_FOUND')).toBe('DESTINATION_NOT_FOUND');
    expect(categorizeTeamsErrorCode('APP_NOT_INSTALLED')).toBe('APP_NOT_INSTALLED');
  });

  it('routes PATCH_NOT_SUPPORTED to UNKNOWN (DEGRADED, not failure)', () => {
    expect(categorizeTeamsErrorCode('PATCH_NOT_SUPPORTED')).toBe('UNKNOWN');
  });

  it('classifies consent/permission signals as CONSENT_REQUIRED', () => {
    expect(categorizeTeamsErrorCode('consent_required')).toBe('CONSENT_REQUIRED');
    expect(categorizeTeamsErrorCode('Missing permission: ChannelMessage.Send.Group')).toBe('CONSENT_REQUIRED');
  });

  it('classifies auth/unauthorized/forbidden as AUTH_EXPIRED', () => {
    expect(categorizeTeamsErrorCode('401 Unauthorized')).toBe('AUTH_EXPIRED');
    expect(categorizeTeamsErrorCode('403 Forbidden')).toBe('AUTH_EXPIRED');
    expect(categorizeTeamsErrorCode('AUTH_EXPIRED')).toBe('AUTH_EXPIRED');
  });

  it('is case-insensitive on code canonicalization', () => {
    expect(categorizeTeamsErrorCode('not_configured')).toBe('NOT_CONFIGURED');
    expect(categorizeTeamsErrorCode('Not_Configured')).toBe('NOT_CONFIGURED');
  });

  it('returns UNKNOWN for empty/unknown codes (fail-closed)', () => {
    expect(categorizeTeamsErrorCode(undefined)).toBe('UNKNOWN');
    expect(categorizeTeamsErrorCode('')).toBe('UNKNOWN');
    expect(categorizeTeamsErrorCode('SOME_NEW_GRAPH_ERROR')).toBe('UNKNOWN');
  });
});

describe('Microsoft Teams capability invariants', () => {
  it('required RSC permissions are the fail-closed set used by capabilities/health', async () => {
    expect(MICROSOFT_TEAMS_REQUIRED_RSC_PERMISSIONS).toEqual([
      'ChannelSettings.Read.Group',
      'ChannelMessage.Send.Group',
    ]);
  });
});
