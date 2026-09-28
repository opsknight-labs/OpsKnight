export type LoadScaleProfile = 'small' | 'medium' | 'large' | 'storm';
export type ScaleProfileName = LoadScaleProfile;

export interface ScaleDimensions {
  profile: LoadScaleProfile;
  teams: number;
  users: number;
  services: number;
  integrationsPerService: number;
  schedules: number;
  escalationPolicies: number;
  baselineIncidents: number;
  statusPageSubscribers: number;
  sseSessions: number;
  apiKeys: number;
}

export const SCALE_PROFILES: Record<LoadScaleProfile, ScaleDimensions> = {
  small: {
    profile: 'small',
    teams: 4,
    users: 40,
    services: 12,
    integrationsPerService: 2,
    schedules: 8,
    escalationPolicies: 8,
    baselineIncidents: 24,
    statusPageSubscribers: 1_000,
    sseSessions: 100,
    apiKeys: 12,
  },
  medium: {
    profile: 'medium',
    teams: 8,
    users: 120,
    services: 32,
    integrationsPerService: 4,
    schedules: 16,
    escalationPolicies: 16,
    baselineIncidents: 100,
    statusPageSubscribers: 10_000,
    sseSessions: 500,
    apiKeys: 32,
  },
  large: {
    profile: 'large',
    teams: 12,
    users: 400,
    services: 80,
    integrationsPerService: 5,
    schedules: 32,
    escalationPolicies: 32,
    baselineIncidents: 300,
    statusPageSubscribers: 100_000,
    sseSessions: 2_500,
    apiKeys: 64,
  },
  storm: {
    profile: 'storm',
    teams: 20,
    users: 1_000,
    services: 200,
    integrationsPerService: 5,
    schedules: 50,
    escalationPolicies: 50,
    baselineIncidents: 500,
    statusPageSubscribers: 100_000,
    sseSessions: 5_000,
    apiKeys: 100,
  },
};

export interface LoadUserFixture {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'RESPONDER' | 'USER';
  status: 'ACTIVE';
  phoneNumber: string;
  timeZone: string;
  teamId: string;
  teamRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  whatsappNotificationsEnabled: boolean;
  sessionJti: string;
  webPushDeviceId: string;
  webPushEndpoint: string;
}

export interface LoadTeamFixture {
  id: string;
  name: string;
  description: string;
  teamLeadId: string;
}

const TIMEZONES = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata'] as const;

export function buildTeamFixtures(scale: ScaleDimensions): LoadTeamFixture[] {
  const teams: LoadTeamFixture[] = [];
  for (let i = 0; i < scale.teams; i++) {
    const index = i + 1;
    teams.push({
      id: `lt-team-${String(index).padStart(3, '0')}`,
      name: `LoadCert Team ${String(index).padStart(2, '0')}`,
      description: `Deterministic load-certification engineering team #${index}`,
      teamLeadId: `lt-user-${String(i * Math.max(1, Math.floor(scale.users / scale.teams)) + 1).padStart(4, '0')}`,
    });
  }
  return teams;
}

export function buildUserFixtures(
  scale: ScaleDimensions,
  pushEmulatorBaseUrlOrTeams: string | LoadTeamFixture[] = 'http://push.emulator.opsknight.internal:8086',
  maybePushBaseUrl?: string
): LoadUserFixture[] {
  const pushEmulatorBaseUrl =
    typeof pushEmulatorBaseUrlOrTeams === 'string'
      ? pushEmulatorBaseUrlOrTeams
      : maybePushBaseUrl || 'http://push.emulator.opsknight.internal:8086';
  const users: LoadUserFixture[] = [];
  const usersPerTeam = Math.max(1, Math.floor(scale.users / scale.teams));

  for (let i = 0; i < scale.users; i++) {
    const index = i + 1;
    const teamIndex = Math.min(scale.teams - 1, Math.floor(i / usersPerTeam));
    const withinTeamIndex = i % usersPerTeam;
    const userId = `lt-user-${String(index).padStart(4, '0')}`;
    const teamId = `lt-team-${String(teamIndex + 1).padStart(3, '0')}`;
    const role: LoadUserFixture['role'] =
      index <= Math.max(4, Math.ceil(scale.users * 0.05))
        ? 'ADMIN'
        : index <= Math.ceil(scale.users * 0.85)
          ? 'RESPONDER'
          : 'USER';
    const teamRole: LoadUserFixture['teamRole'] =
      withinTeamIndex === 0 ? 'OWNER' : withinTeamIndex === 1 ? 'ADMIN' : 'MEMBER';
    const phoneSuffix = String(1000000 + index).slice(-7);

    users.push({
      id: userId,
      email: `responder-${String(index).padStart(4, '0')}@loadtest.opsknight.internal`,
      name: `Responder ${String(index).padStart(4, '0')}`,
      role,
      status: 'ACTIVE',
      phoneNumber: `+1555${phoneSuffix}`,
      timeZone: TIMEZONES[i % TIMEZONES.length],
      teamId,
      teamRole,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: index % 2 === 0,
      pushNotificationsEnabled: index % 3 !== 0,
      whatsappNotificationsEnabled: false,
      sessionJti: `lt-session-jti-${String(index).padStart(6, '0')}-deterministic`,
      webPushDeviceId: `web:lt-device-${String(index).padStart(4, '0')}`,
      webPushEndpoint: `${pushEmulatorBaseUrl.replace(/\/$/, '')}/push/${userId}`,
    });
  }
  return users;
}
