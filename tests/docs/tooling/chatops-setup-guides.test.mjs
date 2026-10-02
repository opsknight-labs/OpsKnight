import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const slack = readFileSync(
  'docs/v2.0.0/integrations/communication/slack/connect-with-oauth.md',
  'utf8'
);
const teams = readFileSync(
  'docs/v2.0.0/integrations/communication/microsoft-teams/connect.md',
  'utf8'
);

test('Slack setup guide covers the complete app and ChatOps journey', () => {
  for (const requirement of [
    '/api/slack/oauth/callback',
    '/api/slack/actions',
    '/api/slack/events',
    '/api/slack/commands',
    'Signing Secret',
    'channels:manage',
    'users:read.email',
    'Configure service delivery',
    'Configure responder actions',
    'Production acceptance checklist',
  ]) assert.ok(slack.includes(requirement), `Slack setup guide must cover ${requirement}`);
});

test('Teams setup guide covers the complete Microsoft 365 and ChatOps journey', () => {
  for (const requirement of [
    'Microsoft Entra application',
    '/api/microsoft-teams/messages',
    'Azure Bot',
    'ChannelSettings.Read.Group',
    'Channel.Create.Group',
    'TeamsAppInstallation.Read.Group',
    'Install the Teams application package',
    'Configure service destinations',
    'Configure identities and incident actions',
    'Production acceptance checklist',
  ]) assert.ok(teams.includes(requirement), `Teams setup guide must cover ${requirement}`);
});
