import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  SLACK_ADVANCED_BOT_SCOPES,
  SLACK_BOT_EVENTS,
  SLACK_COMMAND_USAGE_HINT,
  SLACK_OPTIONAL_BOT_SCOPES,
  SLACK_REQUIRED_BOT_SCOPES,
  buildSlackAppManifest,
} from '@/lib/slack/app-manifest';
import { computeSlackScopeHealth } from '@/lib/slack/health';
import { moreActionsOverflow } from '@/lib/chatops/slack-action-map';
import { buildUpdateOverflowOptions } from '@/lib/slack/update-actions';
import { SLACK_SHORTCUTS } from '@/lib/slack/shortcut-definitions';

const manifest = buildSlackAppManifest({ baseUrl: 'https://ops.example.com' });

describe('SlackOps wiring', () => {
  it('offers the update options in the More actions menu with the handlers’ own values', () => {
    const overflow = moreActionsOverflow('inc-1');
    const values = overflow.options.map(option => option.value);
    for (const option of buildUpdateOverflowOptions('inc-1'))
      expect(values).toContain(option.value);
    // Slack allows at most five options and 75 characters per value.
    expect(overflow.options.length).toBeLessThanOrEqual(5);
    for (const value of values) expect(value.length).toBeLessThanOrEqual(75);
  });

  it('declares the shortcuts, the Home tab and the App Home event in the manifest', () => {
    expect(manifest.features.shortcuts).toEqual(SLACK_SHORTCUTS.map(shortcut => ({ ...shortcut })));
    expect(manifest.features.shortcuts.map(shortcut => shortcut.type).sort()).toEqual([
      'global',
      'message',
    ]);
    expect(manifest.features.app_home.home_tab_enabled).toBe(true);
    expect(manifest.settings.event_subscriptions.bot_events).toContain('app_home_opened');
    expect(SLACK_BOT_EVENTS).toContain('app_home_opened');
  });

  it('requests the advanced scopes but never reports them as a gap', () => {
    for (const scope of SLACK_ADVANCED_BOT_SCOPES)
      expect(manifest.oauth_config.scopes.bot).toContain(scope);
    // An install that has every required and optional scope is healthy without the advanced ones.
    const granted = [...SLACK_REQUIRED_BOT_SCOPES, ...SLACK_OPTIONAL_BOT_SCOPES];
    const result = computeSlackScopeHealth(granted);
    expect(result.manifestOutdated).toBe(false);
    expect(result.healthy).toBe(true);
    expect(result.missingOptional.map(item => item.scope)).not.toEqual(
      expect.arrayContaining([...SLACK_ADVANCED_BOT_SCOPES])
    );
  });

  it('lists every new command in the usage hint', () => {
    for (const word of [
      'page',
      'assign',
      'priority',
      'urgency',
      'title',
      'describe',
      'status',
      'runbook',
      'action',
      'actions',
    ])
      expect(SLACK_COMMAND_USAGE_HINT).toContain(word);
  });
});
