import { describe, it, expect } from 'vitest';
import {
  buildSlackAppManifest,
  buildSlackAppManifestJson,
  findMissingOptionalScopes,
  findMissingRequiredScopes,
  SLACK_BOT_SCOPES,
  SLACK_OPTIONAL_BOT_SCOPES,
  SLACK_REQUIRED_BOT_SCOPES,
} from '@/lib/slack/app-manifest';

const BASE = 'https://opsknight.example.com';

describe('Slack app manifest', () => {
  it('points every endpoint at the deployment base URL', () => {
    const m = buildSlackAppManifest({ baseUrl: BASE });

    expect(m.oauth_config.redirect_urls).toEqual([`${BASE}/api/slack/oauth/callback`]);
    expect(m.settings.interactivity.request_url).toBe(`${BASE}/api/slack/actions`);
    expect(m.settings.event_subscriptions.request_url).toBe(`${BASE}/api/slack/events`);
    expect(m.features.slash_commands[0].url).toBe(`${BASE}/api/slack/commands`);
  });

  it('tolerates a base URL with a trailing slash', () => {
    const m = buildSlackAppManifest({ baseUrl: `${BASE}/` });
    expect(m.settings.event_subscriptions.request_url).toBe(`${BASE}/api/slack/events`);
  });

  it('subscribes to reaction_added so pin sync can work', () => {
    // Event Subscriptions is separate from interactivity — buttons work while
    // events silently do not, which is exactly how pin sync failed in prod.
    const m = buildSlackAppManifest({ baseUrl: BASE });
    expect(m.settings.event_subscriptions.bot_events).toContain('reaction_added');
    expect(m.settings.interactivity.is_enabled).toBe(true);
  });

  it('declares every scope the OAuth flow requests', () => {
    // The manifest previously omitted scopes the OAuth URL asked for, so a
    // reinstall would drop users:read.email and break responder auto-invite.
    const m = buildSlackAppManifest({ baseUrl: BASE });
    for (const scope of SLACK_BOT_SCOPES) {
      expect(m.oauth_config.scopes.bot, scope).toContain(scope);
    }
  });

  it('includes the scopes the war-room flow depends on', () => {
    const required = [...SLACK_REQUIRED_BOT_SCOPES];
    expect(required).toContain('channels:manage'); // create the war-room
    expect(required).toContain('users:read.email'); // auto-invite responders
    expect(required).toContain('reactions:read'); // receive pin events
    expect(required).toContain('channels:history'); // read the pinned message
  });

  it('requests the commands scope for the slash command it declares', () => {
    // Slack rejects a manifest that defines slash_commands without `commands`,
    // and an OAuth install without it cannot receive /incident.
    const m = buildSlackAppManifest({ baseUrl: BASE });
    expect(m.features.slash_commands.length).toBeGreaterThan(0);
    expect(m.oauth_config.scopes.bot).toContain('commands');
    expect([...SLACK_REQUIRED_BOT_SCOPES]).toContain('commands');
    expect(SLACK_BOT_SCOPES).toContain('commands');
  });

  it('advertises only slash subcommands that exist', () => {
    const hint = buildSlackAppManifest({ baseUrl: BASE }).features.slash_commands[0].usage_hint;
    for (const real of ['ack', 'resolve', 'note', 'declare', 'list', 'oncall', 'who', 'help']) {
      expect(hint).toContain(real);
    }
    for (const fake of ['reassign', 'create']) {
      expect(hint).not.toContain(fake);
    }
  });

  it('asks for Squire’s scopes as optional, with the mention event', () => {
    const m = buildSlackAppManifest({ baseUrl: BASE });
    // chat:write.customize only changes how Squire's messages are labelled; never required.
    expect([...SLACK_REQUIRED_BOT_SCOPES]).not.toContain('chat:write.customize');
    expect(SLACK_BOT_SCOPES).toContain('chat:write.customize');
    expect(m.oauth_config.scopes.bot).toContain('app_mentions:read');
    expect(m.settings.event_subscriptions.bot_events).toContain('app_mention');
  });

  it('keeps the newer capability scopes optional so old installs keep working', () => {
    for (const scope of ['pins:write', 'bookmarks:write', 'im:write', 'chat:write.public']) {
      expect([...SLACK_REQUIRED_BOT_SCOPES]).not.toContain(scope);
      expect(SLACK_OPTIONAL_BOT_SCOPES as readonly string[]).toContain(scope);
    }
  });

  it('enables the messages tab for DM paging and keeps the bot online', () => {
    const m = buildSlackAppManifest({ baseUrl: BASE });
    expect(m.features.app_home.messages_tab_enabled).toBe(true);
    expect(m.features.bot_user.always_online).toBe(true);
  });

  it('serialises to valid, pasteable JSON', () => {
    const json = buildSlackAppManifestJson({ baseUrl: BASE });
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).toContain('\n  '); // pretty-printed for a human to read
  });

  describe('findMissingRequiredScopes', () => {
    it('reports nothing when every required scope is granted', () => {
      expect(findMissingRequiredScopes([...SLACK_REQUIRED_BOT_SCOPES])).toEqual([]);
    });

    it('reports the gap for the real pre-fix production grant', () => {
      // Exactly what the Aug 10 install had — the checklist called this healthy.
      const granted = [
        'chat:write',
        'channels:read',
        'groups:read',
        'im:read',
        'mpim:read',
        'users:read',
        'channels:join',
        'channels:manage',
        'groups:write',
        'users:read.email',
      ];
      expect(findMissingRequiredScopes(granted)).toEqual([
        'channels:history',
        'reactions:read',
        'commands',
      ]);
    });

    it('lists optional scopes separately from required ones', () => {
      expect(findMissingOptionalScopes([...SLACK_BOT_SCOPES])).toEqual([]);
      expect(findMissingOptionalScopes([...SLACK_REQUIRED_BOT_SCOPES])).toEqual([
        ...SLACK_OPTIONAL_BOT_SCOPES,
      ]);
    });

    it('treats a missing scope list as everything missing', () => {
      expect(findMissingRequiredScopes(undefined)).toEqual([...SLACK_REQUIRED_BOT_SCOPES]);
    });
  });
});
