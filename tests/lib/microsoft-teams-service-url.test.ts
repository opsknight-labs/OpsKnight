import { describe, expect, it } from 'vitest';
import { normalizeTrustedMicrosoftTeamsServiceUrl } from '@/lib/microsoft-teams/service-url';

describe('Microsoft Teams Bot Connector service URL boundary', () => {
  it('accepts documented public and sovereign endpoints', () => {
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.trafficmanager.net/emea/')).toBe('https://smba.trafficmanager.net/emea');
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.infra.gcc.teams.microsoft.com/teams')).toBe('https://smba.infra.gcc.teams.microsoft.com/teams');
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.infra.gov.teams.microsoft.us/teams/')).toBe('https://smba.infra.gov.teams.microsoft.us/teams');
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.infra.dod.teams.microsoft.us/teams')).toBe('https://smba.infra.dod.teams.microsoft.us/teams');
  });

  it('rejects token-exfiltration and URL-confusion forms', () => {
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('http://smba.trafficmanager.net/teams')).toBeNull();
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.trafficmanager.net.evil.example/teams')).toBeNull();
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.trafficmanager.net@evil.example/teams')).toBeNull();
    expect(normalizeTrustedMicrosoftTeamsServiceUrl('https://smba.trafficmanager.net/teams?next=https://evil.example')).toBeNull();
  });
});
