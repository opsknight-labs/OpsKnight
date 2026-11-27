import 'server-only';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getMicrosoftTeamsConfig } from './auth';
import { MICROSOFT_TEAMS_MANIFEST_VERSION } from './app-manifest';
import type { TeamsRscGrantState } from './client';
import { getInstalledTeamsAppVersion, probeMicrosoftTeamsCredentials } from './graph/credentials';
import { describeTeamsSecretExpiry, getTeamsSecretExpiryState } from './secret-expiry';

/**
 * The Teams settings "Health checklist": each row is a real probe or a database fact, in plain
 * English, with the next step when it is not passing. Never throws: a failed probe is a row.
 */

export type TeamsHealthCheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export type TeamsHealthCheckId =
  | 'credentials'
  | 'secret_expiry'
  | 'tenant'
  | 'installation'
  | 'app_version'
  | 'permissions'
  | 'inbound_activity'
  | 'squire_chat'
  | 'channel_capacity';

export type TeamsHealthCheck = {
  id: TeamsHealthCheckId;
  label: string;
  status: TeamsHealthCheckStatus;
  detail: string;
  /** Machine-readable reason (Entra / Graph code) for support and the API. */
  code?: string;
};

export type TeamsHealthChecklist = {
  checks: TeamsHealthCheck[];
  currentAppVersion: string;
  /** Highest version seen installed in a Team, when Graph lets us read it. */
  installedAppVersion: string | null;
  appUpdateAvailable: boolean;
  lastInboundActivityAt: string | null;
  clientSecretExpiresAt: string | null;
  generatedAt: string;
};

/** Microsoft's per-team channel limit counts deleted channels too. */
export const TEAMS_CHANNELS_PER_TEAM_LIMIT = 1000;
const CHANNEL_WARN_AT = 800;
/** Delivery error codes meaning Teams refused a new channel because the Team is full. */
export const TEAMS_CHANNEL_CAP_ERROR_CODES = [
  'TEAMS_CHANNEL_LIMIT_REACHED',
  'TEAMS_CHANNEL_LIMIT',
  'CHANNEL_LIMIT_REACHED',
];
const MAX_VERSION_PROBES = 3;

/** Numeric semver-ish compare: negative when a < b. Non-numeric parts count as 0. */
export function compareTeamsAppVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    // eslint-disable-next-line security/detect-object-injection -- numeric index into a local array of version parts
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function timeAgo(at: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 10) return 'in the last few minutes';
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

const settle = async <T>(work: Promise<T>, fallback: T, label: string): Promise<T> => {
  try {
    return await work;
  } catch (error) {
    logger.warn(`[MicrosoftTeams] health check ${label} failed`, {
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    return fallback;
  }
};

export async function getMicrosoftTeamsHealthChecklist(options?: {
  rscState?: TeamsRscGrantState | null;
  now?: Date;
}): Promise<TeamsHealthChecklist> {
  const now = options?.now ?? new Date();
  const current = MICROSOFT_TEAMS_MANIFEST_VERSION;
  const resolved = await settle(getMicrosoftTeamsConfig(), null, 'config');
  const base = {
    currentAppVersion: current,
    generatedAt: now.toISOString(),
  };
  if (!resolved) {
    return {
      ...base,
      checks: [
        {
          id: 'credentials',
          label: 'Bot credentials',
          status: 'fail',
          code: 'NOT_CONFIGURED',
          detail: 'Microsoft Teams is not connected. Save the Entra app credentials in Setup.',
        },
      ],
      installedAppVersion: null,
      appUpdateAvailable: false,
      lastInboundActivityAt: null,
      clientSecretExpiresAt: null,
    };
  }
  const { config, clientSecret } = resolved;
  const tenantId = config.tenantId?.trim() || '';
  const secretExpiresAt =
    (config as { clientSecretExpiresAt?: Date | null }).clientSecretExpiresAt ?? null;

  const [installations, squireOn, channelCounts, capErrors] = await Promise.all([
    settle(
      prisma.microsoftTeamsInstallation.findMany({
        where: { enabled: true },
        select: { tenantId: true, teamId: true, teamName: true, lastActivityAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
      [] as Array<{
        tenantId: string;
        teamId: string;
        teamName: string | null;
        lastActivityAt: Date | null;
      }>,
      'installations'
    ),
    settle(
      import('@/lib/chatops/squire/switches').then(m => m.isSquireChatOpsEnabled()),
      false,
      'squire'
    ),
    settle<Array<{ providerContainerId: string | null; _count: { _all: number } }>>(
      // Cast: Prisma's groupBy overloads reject a plain `by` without `orderBy` at the type level.
      (
        prisma.incidentWarRoom.groupBy as unknown as (
          args: unknown
        ) => Promise<Array<{ providerContainerId: string | null; _count: { _all: number } }>>
      )({
        by: ['providerContainerId'],
        where: { provider: 'MICROSOFT_TEAMS', providerChannelId: { not: null } },
        _count: { _all: true },
      }) as Promise<Array<{ providerContainerId: string | null; _count: { _all: number } }>>,
      [],
      'channel counts'
    ),
    settle(
      prisma.incidentWarRoom.count({
        where: {
          provider: 'MICROSOFT_TEAMS',
          lastErrorCode: { in: TEAMS_CHANNEL_CAP_ERROR_CODES },
          updatedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      0,
      'channel cap errors'
    ),
  ]);

  const probeTenant = tenantId || installations[0]?.tenantId || '';
  const [credentials, versions] = await Promise.all([
    settle(
      probeMicrosoftTeamsCredentials({
        clientId: config.clientId,
        clientSecret,
        tenantId: probeTenant,
      }),
      { ok: false as const, code: 'UNAVAILABLE', message: 'Credential check failed to run.' },
      'credentials'
    ),
    Promise.all(
      installations.slice(0, MAX_VERSION_PROBES).map(inst =>
        settle(
          getInstalledTeamsAppVersion({
            tenantId: inst.tenantId,
            teamId: inst.teamId,
            clientId: config.clientId,
          }),
          { ok: false as const, code: 'UNAVAILABLE' as const },
          'app version'
        ).then(result => ({ inst, result }))
      )
    ),
  ]);

  const checks: TeamsHealthCheck[] = [];

  checks.push(
    credentials.ok
      ? {
          id: 'credentials',
          label: 'Bot credentials',
          status: 'pass',
          detail: 'Microsoft accepted the app ID and client secret.',
        }
      : {
          id: 'credentials',
          label: 'Bot credentials',
          status:
            credentials.code === 'NETWORK' || credentials.code === 'UNAVAILABLE'
              ? 'unknown'
              : 'fail',
          code: credentials.code,
          detail: credentials.message,
        }
  );

  const expiry = getTeamsSecretExpiryState(secretExpiresAt, now);
  checks.push({
    id: 'secret_expiry',
    label: 'Client secret expiry',
    status:
      expiry.level === 'ok'
        ? 'pass'
        : expiry.level === 'expired'
          ? 'fail'
          : expiry.level === 'unknown'
            ? 'unknown'
            : 'warn',
    code: expiry.level.toUpperCase(),
    detail: describeTeamsSecretExpiry(expiry),
  });

  checks.push(
    config.tenantMode === 'SINGLE' && !tenantId
      ? {
          id: 'tenant',
          label: 'Tenant',
          status: 'fail',
          code: 'TENANT_REQUIRED',
          detail:
            'No tenant ID is set, so OpsKnight rejects every Teams install and message. Add your Entra tenant ID in Setup.',
        }
      : {
          id: 'tenant',
          label: 'Tenant',
          status: 'pass',
          detail:
            config.tenantMode === 'SINGLE'
              ? 'Only your organization’s tenant can install and use the bot.'
              : 'Any tenant that installs the app can use the bot.',
        }
  );

  checks.push(
    installations.length > 0
      ? {
          id: 'installation',
          label: 'App installed in Teams',
          status: 'pass',
          detail: `Installed in ${installations.length} team${installations.length === 1 ? '' : 's'}.`,
        }
      : {
          id: 'installation',
          label: 'App installed in Teams',
          status: 'fail',
          code: 'APP_NOT_INSTALLED',
          detail:
            'The app isn’t installed in any Team yet. Download the app package and add it to a Team.',
        }
  );

  const readable = versions.filter(
    (
      v
    ): v is {
      inst: (typeof installations)[number];
      result: { ok: true; version: string | null };
    } => v.result.ok
  );
  const seen = readable.map(v => v.result.version).filter((v): v is string => Boolean(v));
  const outdated = readable.filter(
    v => v.result.version && compareTeamsAppVersions(v.result.version, current) < 0
  );
  const installedAppVersion = seen.sort((a, b) => compareTeamsAppVersions(b, a))[0] ?? null;
  const appUpdateAvailable = outdated.length > 0;
  if (installations.length === 0) {
    checks.push({
      id: 'app_version',
      label: 'App package version',
      status: 'unknown',
      detail: `Current package is v${current}. Install it in a Team to compare.`,
    });
  } else if (appUpdateAvailable) {
    const names = outdated
      .map(v => v.inst.teamName || 'a team')
      .slice(0, 3)
      .join(', ');
    checks.push({
      id: 'app_version',
      label: 'App package version',
      status: 'warn',
      code: 'APP_UPDATE_AVAILABLE',
      detail: `${names} ${outdated.length === 1 ? 'runs' : 'run'} v${outdated[0].result.version}; the current package is v${current}. Download the updated package and update the app in Teams so @OpsKnight mentions and chats work.`,
    });
  } else if (seen.length > 0) {
    checks.push({
      id: 'app_version',
      label: 'App package version',
      status: 'pass',
      detail: `Installed version v${installedAppVersion} is current.`,
    });
  } else {
    checks.push({
      id: 'app_version',
      label: 'App package version',
      status: 'unknown',
      code: versions.some(v => !v.result.ok) ? 'VERSION_UNREADABLE' : 'APP_NOT_FOUND',
      detail: `OpsKnight can’t read the installed version from Microsoft Graph. The current package is v${current}; if you installed the app before this release, download the updated package and update it in Teams.`,
    });
  }

  const rsc = options?.rscState ?? null;
  checks.push(
    !rsc || rsc.unknown
      ? {
          id: 'permissions',
          label: 'Teams permissions (RSC)',
          status: 'unknown',
          code: rsc?.error ?? 'NOT_VERIFIED',
          detail:
            'Permissions couldn’t be verified yet. They are checked once the app is installed in a Team.',
        }
      : rsc.missing.length === 0
        ? {
            id: 'permissions',
            label: 'Teams permissions (RSC)',
            status: 'pass',
            detail: 'All required permissions are granted.',
          }
        : {
            id: 'permissions',
            label: 'Teams permissions (RSC)',
            status: 'fail',
            code: 'CONSENT_REQUIRED',
            detail: `Missing: ${rsc.missing.join(', ')}. A Team owner must update or reinstall the app to grant them.`,
          }
  );

  const lastActivity = installations
    .map(i => i.lastActivityAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  checks.push(
    lastActivity
      ? {
          id: 'inbound_activity',
          label: 'Messages from Teams',
          status: 'pass',
          detail: `Last message or card action received ${timeAgo(lastActivity, now)}.`,
        }
      : {
          id: 'inbound_activity',
          label: 'Messages from Teams',
          status: 'unknown',
          detail:
            'Nothing received from Teams yet. Click a card button or mention @OpsKnight to confirm the messaging endpoint works.',
        }
  );

  checks.push(
    squireOn
      ? {
          id: 'squire_chat',
          label: 'Squire in chat',
          status: 'pass',
          detail: '@OpsKnight mentions and personal chats are answered by Squire.',
        }
      : {
          id: 'squire_chat',
          label: 'Squire in chat',
          status: 'warn',
          code: 'SQUIRE_CHAT_OFF',
          detail:
            'Squire in chat is off, so mentions only get a help reply. Turn it on in Settings → Intelligence → AI.',
        }
  );

  const busiest = channelCounts
    .filter(row => row.providerContainerId)
    .sort((a, b) => b._count._all - a._count._all)[0];
  const busiestCount = busiest?._count._all ?? 0;
  const teamName = (teamId: string | null) =>
    installations.find(i => i.teamId === teamId)?.teamName || 'One team';
  checks.push(
    capErrors > 0
      ? {
          id: 'channel_capacity',
          label: 'War-room channel capacity',
          status: 'fail',
          code: 'TEAMS_CHANNEL_LIMIT_REACHED',
          detail:
            'Teams refused to create a war-room channel because the Team has reached its channel limit. Delete old channels permanently or route war rooms to another Team.',
        }
      : busiestCount >= CHANNEL_WARN_AT
        ? {
            id: 'channel_capacity',
            label: 'War-room channel capacity',
            status: 'warn',
            code: 'TEAMS_CHANNEL_NEAR_LIMIT',
            detail: `${teamName(busiest!.providerContainerId)} has ${busiestCount} war-room channels; Teams allows ${TEAMS_CHANNELS_PER_TEAM_LIMIT} per team, archived and deleted ones included. Plan to route war rooms to another Team.`,
          }
        : {
            id: 'channel_capacity',
            label: 'War-room channel capacity',
            status: 'pass',
            detail:
              busiestCount > 0
                ? `Busiest team has ${busiestCount} of ${TEAMS_CHANNELS_PER_TEAM_LIMIT} channels.`
                : 'No war-room channels created yet.',
          }
  );

  return {
    ...base,
    checks,
    installedAppVersion,
    appUpdateAvailable,
    lastInboundActivityAt: lastActivity?.toISOString() ?? null,
    clientSecretExpiresAt: secretExpiresAt ? new Date(secretExpiresAt).toISOString() : null,
  };
}
