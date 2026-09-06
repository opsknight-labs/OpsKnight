import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
  type AuthorizationRequest,
  type AuthorizationResource,
} from '@/lib/authorization-policy';

const actor = (overrides: Partial<AuthorizationActor> = {}): AuthorizationActor => ({
  id: 'user-1',
  role: 'USER',
  status: 'ACTIVE',
  teamIds: ['team-1'],
  ...overrides,
});

const incident = (
  overrides: Partial<Extract<AuthorizationResource, { type: 'incident' }>> = {}
): Extract<AuthorizationResource, { type: 'incident' }> => ({
  type: 'incident',
  visibility: 'PUBLIC',
  serviceTeamId: 'team-1',
  watcherIds: [],
  ...overrides,
});

describe('authorization policy matrix', () => {
  it.each([
    [
      'Admin × private incident',
      actor({ role: 'ADMIN' }),
      incident({ visibility: 'PRIVATE' }),
      true,
    ],
    [
      'Responder × private incident',
      actor({ role: 'RESPONDER' }),
      incident({ visibility: 'PRIVATE' }),
      true,
    ],
    ['User × own-team public', actor(), incident(), true],
    ['User × other-team public', actor(), incident({ serviceTeamId: 'team-2' }), false],
    [
      'User × watcher × private',
      actor(),
      incident({ visibility: 'PRIVATE', serviceTeamId: 'team-2', watcherIds: ['user-1'] }),
      true,
    ],
    [
      'User × own-team private',
      actor(),
      incident({ visibility: 'PRIVATE', serviceTeamId: 'team-1' }),
      false,
    ],
    [
      'Auditor × private incident',
      actor({ role: 'AUDITOR', teamIds: [] }),
      incident({ visibility: 'PRIVATE', serviceTeamId: 'team-2' }),
      true,
    ],
  ])('%s', (_name, testActor, resource, allowed) => {
    expect(
      authorize({
        actor: testActor as AuthorizationActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource,
      }).allowed
    ).toBe(allowed);
  });

  it('denies Auditor incident modification', () => {
    expect(
      authorize({
        actor: actor({ role: 'AUDITOR' }),
        action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
        resource: incident(),
      }).allowed
    ).toBe(false);
  });

  it.each([
    ['acknowledge', AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE],
    ['add a note to', AUTHORIZATION_ACTIONS.INCIDENT_NOTE],
  ])(
    'allows a scoped User to %s a visible incident but keeps Auditor read-only',
    (_name, action) => {
      expect(authorize({ actor: actor(), action, resource: incident() }).allowed).toBe(true);
      expect(
        authorize({ actor: actor({ role: 'AUDITOR' }), action, resource: incident() })
      ).toMatchObject({ allowed: false, reason: 'MISSING_CAPABILITY' });
    }
  );

  it('requires API scope and user permission together', () => {
    const apiActor = actor({
      role: 'USER',
      apiKey: { id: 'key-1', scopes: ['incidents:read'] },
    });
    expect(
      authorize({
        actor: apiActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: incident(),
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: apiActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: incident({ serviceTeamId: 'team-2' }),
      }).allowed
    ).toBe(false);
    expect(
      authorize({
        actor: { ...apiActor, apiKey: { id: 'key-1', scopes: ['services:read'] } },
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: incident(),
      })
    ).toMatchObject({ allowed: false, reason: 'MISSING_SCOPE' });
  });

  it.each(['DISABLED', 'INVITED'] as const)('fails closed for %s users', status => {
    expect(
      authorize({
        actor: actor({ role: 'ADMIN', status }),
        action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
        resource: incident(),
      })
    ).toMatchObject({ allowed: false, reason: 'ACTOR_INACTIVE' });
  });

  it('allows scoped creation only for an owned service team', () => {
    const apiActor = actor({ apiKey: { id: 'key-1', scopes: ['incidents:write'] } });
    expect(
      authorize({
        actor: apiActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
        resource: { type: 'service', teamId: 'team-1' },
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: apiActor,
        action: AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
        resource: { type: 'service', teamId: 'team-2' },
      }).allowed
    ).toBe(false);
  });

  it.each([
    [
      'own service',
      AUTHORIZATION_ACTIONS.SERVICE_READ,
      { type: 'service', teamId: 'team-1' },
      true,
    ],
    [
      'other service',
      AUTHORIZATION_ACTIONS.SERVICE_READ,
      { type: 'service', teamId: 'team-2' },
      false,
    ],
    [
      'participant schedule',
      AUTHORIZATION_ACTIONS.SCHEDULE_READ,
      { type: 'schedule', participantIds: ['user-1'] },
      true,
    ],
    [
      'team schedule',
      AUTHORIZATION_ACTIONS.SCHEDULE_READ,
      { type: 'schedule', relatedTeamIds: ['team-1'] },
      true,
    ],
    [
      'unrelated schedule',
      AUTHORIZATION_ACTIONS.SCHEDULE_READ,
      { type: 'schedule', relatedTeamIds: ['team-2'] },
      false,
    ],
  ])('applies resource scope to %s', (_name, action, resource, allowed) => {
    expect(authorize({ actor: actor(), action, resource } as AuthorizationRequest).allowed).toBe(
      allowed
    );
  });

  it('requires both responder permission and events:write scope for event ingestion', () => {
    expect(
      authorize({
        actor: actor({
          role: 'RESPONDER',
          apiKey: { id: 'key-1', scopes: ['events:write'] },
        }),
        action: AUTHORIZATION_ACTIONS.EVENT_CREATE,
        resource: { type: 'service', teamId: 'team-2' },
      }).allowed
    ).toBe(true);
    expect(
      authorize({
        actor: actor({ role: 'RESPONDER', apiKey: { id: 'key-1', scopes: [] } }),
        action: AUTHORIZATION_ACTIONS.EVENT_CREATE,
      })
    ).toMatchObject({ allowed: false, reason: 'MISSING_SCOPE' });
    expect(
      authorize({
        actor: actor({
          role: 'AUDITOR',
          apiKey: { id: 'key-1', scopes: ['events:write'] },
        }),
        action: AUTHORIZATION_ACTIONS.EVENT_CREATE,
      })
    ).toMatchObject({ allowed: false, reason: 'MISSING_CAPABILITY' });
  });
});
