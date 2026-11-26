import { describe, expect, it } from 'vitest';
import {
  describeTeamsSecretExpiry,
  getTeamsSecretExpiryState,
} from '@/lib/microsoft-teams/secret-expiry';
import {
  buildTeamsHelpCard,
  escapeTeamsMarkdown,
  parseTeamsBotCommand,
  teamsConversationKind,
} from '@/lib/microsoft-teams/bot-commands';
import { describeEntraTokenError } from '@/lib/microsoft-teams/graph/credentials';
import { describeTeamsTestResult } from '@/components/settings/microsoft-teams/teams-test-result';
import { describeTeamsWarRoomProblem } from '@/components/incident/detail/MicrosoftTeamsWarRoomsPanel';

const NOW = new Date('2026-11-27T12:00:00Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

describe('Teams client secret expiry', () => {
  it('is unknown when no date is recorded or the date is invalid', () => {
    expect(getTeamsSecretExpiryState(null, NOW)).toEqual({ level: 'unknown', daysLeft: null });
    expect(getTeamsSecretExpiryState('not-a-date', NOW).level).toBe('unknown');
  });

  it('warns from 30 days, escalates at 7, and fails after expiry', () => {
    expect(getTeamsSecretExpiryState(inDays(31), NOW)).toEqual({ level: 'ok', daysLeft: 31 });
    expect(getTeamsSecretExpiryState(inDays(30), NOW)).toEqual({ level: 'soon', daysLeft: 30 });
    expect(getTeamsSecretExpiryState(inDays(8), NOW).level).toBe('soon');
    expect(getTeamsSecretExpiryState(inDays(7), NOW)).toEqual({ level: 'urgent', daysLeft: 7 });
    expect(getTeamsSecretExpiryState(inDays(0.5), NOW)).toEqual({ level: 'urgent', daysLeft: 1 });
    expect(getTeamsSecretExpiryState(inDays(-0.5), NOW)).toEqual({ level: 'expired', daysLeft: 0 });
    expect(getTeamsSecretExpiryState(inDays(-3), NOW)).toEqual({ level: 'expired', daysLeft: -3 });
    expect(getTeamsSecretExpiryState(inDays(-3).toISOString(), NOW).level).toBe('expired');
  });

  it('describes each state in plain English', () => {
    expect(describeTeamsSecretExpiry({ level: 'soon', daysLeft: 12 })).toContain(
      'expires in 12 days'
    );
    expect(describeTeamsSecretExpiry({ level: 'urgent', daysLeft: 1 })).toContain('in 1 day.');
    expect(describeTeamsSecretExpiry({ level: 'expired', daysLeft: 0 })).toContain('expired today');
    expect(describeTeamsSecretExpiry({ level: 'expired', daysLeft: -4 })).toContain('4 days ago');
    expect(describeTeamsSecretExpiry({ level: 'unknown', daysLeft: null })).toContain(
      'not recorded'
    );
  });
});

describe('Teams bot commands', () => {
  it('parses help, status and everything else as a Squire question', () => {
    expect(parseTeamsBotCommand('<at>OpsKnight</at> help')).toEqual({ kind: 'help' });
    expect(parseTeamsBotCommand('<at>OpsKnight</at>&nbsp;')).toEqual({ kind: 'help' });
    expect(parseTeamsBotCommand(undefined)).toEqual({ kind: 'help' });
    expect(parseTeamsBotCommand('<at>OpsKnight</at> STATUS')).toEqual({ kind: 'status' });
    expect(parseTeamsBotCommand('status of the db?')).toEqual({ kind: 'squire' });
    expect(parseTeamsBotCommand('<at>OpsKnight</at> ack')).toEqual({ kind: 'squire' });
    expect(parseTeamsBotCommand('investigate')).toEqual({ kind: 'squire' });
  });

  it('classifies conversation types and tolerates unknown ones', () => {
    expect(teamsConversationKind({ conversationType: 'personal' })).toBe('personal');
    expect(teamsConversationKind({ conversationType: 'groupChat' })).toBe('groupChat');
    expect(teamsConversationKind({ conversationType: 'channel' })).toBe('channel');
    expect(teamsConversationKind({ conversationType: 'meeting' })).toBe('unknown');
    expect(teamsConversationKind(null)).toBe('unknown');
  });

  it('escapes markdown links, emphasis, HTML and list markers', () => {
    const out = escapeTeamsMarkdown('[x](https://evil) *b* _i_ <img> `c`');
    expect(out).not.toMatch(/(^|[^\\])\[x/);
    expect(out).toContain('&lt;img&gt;');
    expect(out).toContain('\\*b\\*');
    expect(escapeTeamsMarkdown('- item')).toBe('\\- item');
    expect(escapeTeamsMarkdown('1. item')).toBe('\\1. item');
  });

  it('says when Squire in chat is off', () => {
    const off = JSON.stringify(
      buildTeamsHelpCard({ squireEnabled: false, conversation: 'channel' })
    );
    const on = JSON.stringify(
      buildTeamsHelpCard({ squireEnabled: true, conversation: 'personal' })
    );
    expect(off).toContain('Squire in chat is turned off');
    expect(on).not.toContain('turned off');
    expect(on).toContain('investigate');
  });
});

describe('Entra credential errors', () => {
  it('maps the AADSTS codes admins hit to actionable messages', () => {
    expect(describeEntraTokenError([7000222]).code).toBe('SECRET_EXPIRED');
    expect(describeEntraTokenError([7000215]).code).toBe('SECRET_INVALID');
    expect(describeEntraTokenError([700016]).code).toBe('APP_NOT_FOUND');
    expect(describeEntraTokenError([90002]).code).toBe('TENANT_NOT_FOUND');
    expect(describeEntraTokenError([], 'invalid_client').code).toBe('ENTRA_INVALID_CLIENT');
  });
});

describe('Send test card result', () => {
  it('prefers the provider code, then the API code, then the raw error', () => {
    expect(describeTeamsTestResult(true, {})).toMatchObject({ ok: true });
    const provider = describeTeamsTestResult(false, {
      error: 'Forbidden',
      code: 'PROVIDER_ERROR',
      meta: { providerCode: 'APP_NOT_INSTALLED' },
    });
    expect(provider).toMatchObject({ ok: false, code: 'APP_NOT_INSTALLED', detail: 'Forbidden' });
    expect(provider.message).toContain('isn’t installed in this Team');
    expect(describeTeamsTestResult(false, { error: 'HTTP 502' })).toMatchObject({
      ok: false,
      message: 'HTTP 502',
      detail: null,
    });
    // Prototype keys never resolve to a message.
    expect(describeTeamsTestResult(false, { code: 'constructor' }).message).toBe(
      'The test card could not be sent.'
    );
  });
});

describe('Teams war-room panel wording', () => {
  it('explains known problems without internal jargon', () => {
    expect(
      describeTeamsWarRoomProblem({ state: 'AMBIGUOUS', lastErrorCode: null, lastError: null })
    ).toContain('isn’t sure whether Teams finished creating the channel');
    expect(
      describeTeamsWarRoomProblem({
        state: 'READY',
        lastErrorCode: 'PROJECTION_RETRIES_EXHAUSTED',
        lastError: 'Graph 500 ...',
      })
    ).toContain('Refresh incident card');
    expect(
      describeTeamsWarRoomProblem({
        state: 'READY',
        health: 'PERMISSION_ERROR',
        lastErrorCode: null,
        lastError: null,
      })
    ).toContain('permission');
    expect(
      describeTeamsWarRoomProblem({
        state: 'READY',
        health: 'HEALTHY',
        lastErrorCode: null,
        lastError: null,
      })
    ).toBeNull();
  });
});
