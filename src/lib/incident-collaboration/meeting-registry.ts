/**
 * Meeting Provider Registry & Adapters
 *
 * Implements deterministic meeting bridge provisioning across:
 * - Native Microsoft Teams Online Meetings (via Microsoft Graph createOrGet with idempotency key)
 * - Jitsi Meet (0-setup instant rooms)
 * - Zoom (template & personal meeting links)
 * - Google Meet (lookup codes & templates)
 *
 * Strict invariant: NO SILENT FALLBACK.
 */

import { generateBridgeUrl } from '@/lib/war-room/bridge';
import { getMicrosoftTeamsConfig } from '@/lib/microsoft-teams/auth';
import { getMicrosoftTeamsGraphAccessToken } from '@/lib/microsoft-teams/client';
import { WarRoomRetryableError } from '@/lib/war-room/errors';
import type { IncidentMeetingProvider, IncidentMeetingReadiness } from './types';
import prisma from '@/lib/prisma';

export type CreateOrGetMeetingInput = {
  incidentId: string;
  incidentNumber?: number;
  incidentTitle: string;
  generation?: number;
  customTemplate?: string | null;
};

export type MeetingResult = {
  externalId: string;
  joinUrl: string;
  joinWebUrl?: string | null;
  conferenceId?: string | null;
  tollNumber?: string | null;
  providerMeetingId?: string | null;
  organizerEmail?: string | null;
  metadata?: Record<string, unknown>;
};

export interface MeetingAvailabilityResult {
  available: boolean;
  readiness?: IncidentMeetingReadiness;
  reason?: string;
}

export type CloseMeetingParams = {
  providerMeetingId?: string | null;
  organizerEmail?: string | null;
  externalId?: string;
};

export interface MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider;
  readonly supportsExternalClose?: boolean;
  isAvailable(
    customTemplate?: string | null,
    incidentId?: string
  ): Promise<MeetingAvailabilityResult>;
  createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult>;
  closeMeeting?(params: CloseMeetingParams): Promise<void>;
}

async function resolveGlobalCustomBridgeTemplate(): Promise<string | null> {
  if (prisma?.chatOpsConfig?.findUnique) {
    try {
      const config = await prisma.chatOpsConfig.findUnique({
        where: { id: 'default' },
        select: { customBridgeUrlTemplate: true },
      });
      if (config?.customBridgeUrlTemplate?.trim()) {
        return config.customBridgeUrlTemplate.trim();
      }
    } catch {
      // Fallback to null
    }
  }
  return null;
}

/**
 * Microsoft Teams Native Online Meeting Adapter
 * Uses Microsoft Graph /users/{userId}/onlineMeetings/createOrGet with deterministic idempotency key.
 */
export class TeamsMeetingAdapter implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'MICROSOFT_TEAMS';
  readonly supportsExternalClose = true;

  async resolveOrganizer(
    incidentId: string,
    tenantId: string,
    defaultOrganizerUpn?: string | null
  ): Promise<{ userId: string; email?: string } | null> {
    // 1. If global default organizer is configured, use it
    if (defaultOrganizerUpn && defaultOrganizerUpn.trim()) {
      return { userId: defaultOrganizerUpn.trim(), email: defaultOrganizerUpn.trim() };
    }

    // 2. Try incident assignee's connected Microsoft Teams identity
    if (prisma?.incident?.findUnique) {
      const incident = await prisma.incident
        .findUnique({
          where: { id: incidentId },
          select: {
            assigneeId: true,
            service: {
              select: {
                team: {
                  select: {
                    teamLeadId: true,
                    teamLead: { select: { email: true } },
                  },
                },
              },
            },
          },
        })
        .catch(() => null);

      const candidateUserIds = [incident?.assigneeId, incident?.service?.team?.teamLeadId].filter(
        (id): id is string => Boolean(id)
      );

      if (candidateUserIds.length > 0 && prisma?.chatIdentityLink?.findMany) {
        const links = await prisma.chatIdentityLink
          .findMany({
            where: {
              provider: 'MICROSOFT_TEAMS',
              providerTenantId: tenantId,
              revokedAt: null,
              userId: { in: candidateUserIds },
            },
            select: { userId: true, providerUserId: true, providerObjectId: true },
          })
          .catch(() => []);

        for (const userId of candidateUserIds) {
          const match = links.find(l => l.userId === userId);
          const objId = match?.providerObjectId || match?.providerUserId;
          if (objId) {
            return { userId: objId };
          }
        }
      }

      // 3. Try team lead email
      if (incident?.service?.team?.teamLead?.email) {
        return {
          userId: incident.service.team.teamLead.email,
          email: incident.service.team.teamLead.email,
        };
      }
    }

    // 4. Check for any active installation installer in the same tenant
    if (prisma?.microsoftTeamsInstallation?.findFirst) {
      const inst = await prisma.microsoftTeamsInstallation
        .findFirst({
          where: { tenantId, enabled: true },
          select: { installer: { select: { email: true } } },
        })
        .catch(() => null);

      if (inst?.installer?.email) {
        return { userId: inst.installer.email, email: inst.installer.email };
      }
    }

    return null;
  }

  async isAvailable(
    customTemplate?: string | null,
    incidentId?: string
  ): Promise<MeetingAvailabilityResult> {
    try {
      if (customTemplate && customTemplate.trim()) {
        return { available: true, readiness: 'READY' };
      }

      const resolved = await getMicrosoftTeamsConfig();
      if (!resolved || !resolved.config.enabled) {
        return {
          available: false,
          readiness: 'UNAVAILABLE',
          reason: 'Microsoft Teams integration is disabled or unconfigured in settings.',
        };
      }

      // Check for at least one active installation or destination
      const install = prisma?.microsoftTeamsInstallation?.findFirst
        ? await prisma.microsoftTeamsInstallation
            .findFirst({
              where: { enabled: true },
              select: { tenantId: true },
            })
            .catch(() => null)
        : null;

      const tenantId = install?.tenantId || resolved.config.tenantId;
      if (!tenantId) {
        return {
          available: false,
          readiness: 'UNAVAILABLE',
          reason: 'No Microsoft Entra tenant ID configured for Microsoft Teams.',
        };
      }

      // Proactive probe: Check organizer availability
      const defaultOrganizer = (resolved.config as { defaultMeetingOrganizerUpn?: string | null })
        ?.defaultMeetingOrganizerUpn;
      const organizer = incidentId
        ? await this.resolveOrganizer(incidentId, tenantId, defaultOrganizer)
        : defaultOrganizer?.trim()
          ? { userId: defaultOrganizer.trim(), email: defaultOrganizer.trim() }
          : null;

      if (!organizer) {
        return {
          available: false,
          readiness: 'ORGANIZER_REQUIRED',
          reason:
            'No meeting organizer configured. Set Default Meeting Organizer in Settings > ChatOps, or link a Teams user.',
        };
      }

      // Proactive probe: Check Graph access token acquisition
      const token = await getMicrosoftTeamsGraphAccessToken(tenantId).catch(() => null);
      if (!token) {
        return {
          available: false,
          readiness: 'PERMISSION_REQUIRED',
          reason:
            'Unable to acquire Microsoft Graph token. Verify Entra application credentials in settings.',
        };
      }

      return {
        available: true,
        readiness: 'CONFIGURED',
        reason:
          'Entra credentials verified. Meeting creation permissions will be validated upon launch.',
      };
    } catch (e) {
      return {
        available: false,
        readiness: 'UNAVAILABLE',
        reason: (e as Error).message || 'Failed to verify Microsoft Teams availability.',
      };
    }
  }

  async closeMeeting(params: CloseMeetingParams): Promise<void> {
    const { providerMeetingId, organizerEmail } = params;
    if (!providerMeetingId) return;

    const resolved = await getMicrosoftTeamsConfig();
    if (!resolved || !resolved.config.enabled) return;
    const tenantId = resolved.config.tenantId;
    if (!tenantId) return;

    const defaultOrganizer = (resolved.config as { defaultMeetingOrganizerUpn?: string | null })
      ?.defaultMeetingOrganizerUpn;
    const organizerUpn = organizerEmail || defaultOrganizer?.trim();
    if (!organizerUpn) return;

    let token: string | null;
    try {
      token = await getMicrosoftTeamsGraphAccessToken(tenantId);
    } catch (e) {
      throw new WarRoomRetryableError(
        `Failed to acquire Graph token for meeting close: ${(e as Error).message}`,
        10_000
      );
    }
    if (!token) {
      throw new WarRoomRetryableError('Empty Graph token acquired for meeting close', 10_000);
    }

    let res: Response;
    try {
      res = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizerUpn)}/onlineMeetings/${encodeURIComponent(providerMeetingId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
    } catch (netErr) {
      throw new WarRoomRetryableError(
        `Network error while deleting Teams online meeting: ${(netErr as Error).message}`,
        5_000
      );
    }

    // 204 No Content: Successful deletion per Graph API specification
    if (res.status === 204) {
      return;
    }

    // 404 Not Found: Idempotent completion (meeting already deleted or nonexistent)
    if (res.status === 404) {
      return;
    }

    // 429 Too Many Requests: Rate limited -> retryable, honor Retry-After
    if (res.status === 429) {
      const retryHeader = res.headers.get('Retry-After');
      const retrySeconds = retryHeader ? parseInt(retryHeader, 10) : 30;
      const retryAfterMs =
        Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds * 1000 : 30_000;
      throw new WarRoomRetryableError(
        'Microsoft Graph rate limit exceeded (429) on meeting delete',
        retryAfterMs
      );
    }

    // 5xx Server Error: Transient -> retryable
    if (res.status >= 500) {
      throw new WarRoomRetryableError(
        `Microsoft Graph server error (${res.status}) on meeting delete`,
        15_000
      );
    }

    // 401 / 403: Permission / authorization failure -> terminal
    if (res.status === 401 || res.status === 403) {
      const errBody = await res.text().catch(() => '');
      throw new Error(
        `Microsoft Graph permission denied (${res.status}) on meeting delete: ${errBody.slice(0, 200)}`
      );
    }

    // Other 4xx: Terminal client error
    const errBody = await res.text().catch(() => '');
    throw new Error(
      `Microsoft Graph returned unexpected status (${res.status}) on meeting delete: ${errBody.slice(0, 200)}`
    );
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;

    const resolved = await getMicrosoftTeamsConfig();
    if (!resolved || !resolved.config.enabled) {
      throw new Error('Microsoft Teams integration is disabled or not configured in settings.');
    }

    const install = prisma?.microsoftTeamsInstallation?.findFirst
      ? await prisma.microsoftTeamsInstallation
          .findFirst({
            where: { enabled: true },
            select: { tenantId: true },
          })
          .catch(() => null)
      : null;

    const tenantId = install?.tenantId || resolved.config.tenantId;
    if (!tenantId) {
      throw new Error(
        'Microsoft Teams tenant ID is missing. Please configure Microsoft Teams in settings.'
      );
    }

    // Check if custom static template or join URL is explicitly provided
    if (input.customTemplate && input.customTemplate.trim()) {
      const customUrl = generateBridgeUrl(
        input.incidentId,
        'MICROSOFT_TEAMS',
        input.customTemplate
      );
      if (customUrl) {
        return {
          externalId,
          joinUrl: customUrl,
          joinWebUrl: customUrl,
        };
      }
    }

    // Resolve organizer user ID or UPN for Graph application access
    const defaultOrganizer = (resolved.config as { defaultMeetingOrganizerUpn?: string | null })
      ?.defaultMeetingOrganizerUpn;
    const organizer = await this.resolveOrganizer(input.incidentId, tenantId, defaultOrganizer);
    if (!organizer) {
      throw new Error(
        'No Microsoft Teams meeting organizer user found. Set Default Meeting Organizer in ChatOps settings, link a responder account, or configure a team lead.'
      );
    }

    // Acquire Microsoft Graph access token
    const token = await getMicrosoftTeamsGraphAccessToken(tenantId);
    if (!token) {
      throw new Error(
        'Failed to acquire Microsoft Graph access token. Verify Entra application credentials.'
      );
    }

    const incidentDisplay = input.incidentNumber
      ? `#${input.incidentNumber}`
      : input.incidentId.slice(-8);
    const subject = `[Incident ${incidentDisplay}] ${input.incidentTitle} - War Room`;
    const now = new Date();
    const end = new Date(now.getTime() + 8 * 3600 * 1000); // 8-hour war room window

    // Graph createOrGet endpoint using application permission on target user:
    // POST /users/{userId}/onlineMeetings/createOrGet
    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(organizer.userId)}/onlineMeetings/createOrGet`;
    const payload = {
      externalId,
      subject,
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
    };

    let res: Response;
    try {
      res = await fetch(graphEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      throw new Error(
        `Failed to reach Microsoft Graph online meetings API: ${(e as Error).message}`
      );
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After') || '30';
      const err = new Error(
        `Microsoft Graph rate limit exceeded (429). Please retry after ${retryAfter} seconds.`
      );
      (err as unknown as { retryAfterSeconds: number }).retryAfterSeconds =
        parseInt(retryAfter, 10) || 30;
      throw err;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Microsoft Graph returned ${res.status}: Ensure 'OnlineMeetings.ReadWrite.All' application permission is granted and an Application Access Policy is assigned to the organizer in Microsoft Entra.`
        );
      }
      throw new Error(
        `Microsoft Graph meeting creation failed (${res.status}): ${errBody.slice(0, 300)}`
      );
    }

    const data = (await res.json()) as {
      id?: string;
      joinUrl?: string;
      joinWebUrl?: string;
      audioConferencing?: {
        conferenceId?: string;
        tollNumber?: string;
        tollFreeNumber?: string;
      };
      participants?: {
        organizer?: {
          upn?: string;
          email?: string;
        };
      };
    };

    const joinUrl = data.joinWebUrl || data.joinUrl;
    if (!joinUrl) {
      throw new Error('Microsoft Graph did not return a valid join URL for the online meeting.');
    }

    return {
      externalId,
      joinUrl,
      joinWebUrl: data.joinWebUrl || null,
      conferenceId: data.audioConferencing?.conferenceId || null,
      tollNumber: data.audioConferencing?.tollNumber || null,
      providerMeetingId: data.id || null,
      organizerEmail:
        data.participants?.organizer?.email ||
        data.participants?.organizer?.upn ||
        organizer.email ||
        null,
      metadata: {
        rawId: data.id,
      },
    };
  }
}

/**
 * Jitsi Meet Adapter
 * Instant 0-setup room generated deterministically per incident.
 */
export class JitsiMeetingAdapter implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'JITSI';
  readonly supportsExternalClose = false;

  async isAvailable(): Promise<MeetingAvailabilityResult> {
    return { available: true, readiness: 'READY' };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;
    const joinUrl =
      generateBridgeUrl(input.incidentId, 'JITSI', input.customTemplate) ||
      `https://meet.jit.si/opsknight-inc-${input.incidentId.slice(-8)}`;

    return {
      externalId,
      joinUrl,
      joinWebUrl: joinUrl,
    };
  }
}

/**
 * Zoom Meeting Adapter
 * Requires a configured meeting bridge URL template in settings or service config.
 * Strict invariant: Never fabricates non-existent vanity URLs.
 */
export class ZoomMeetingAdapter implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'ZOOM';
  readonly supportsExternalClose = false;

  async isAvailable(customTemplate?: string | null): Promise<MeetingAvailabilityResult> {
    if (customTemplate && customTemplate.trim()) {
      return { available: true, readiness: 'READY' };
    }
    const globalTemplate = await resolveGlobalCustomBridgeTemplate();
    if (globalTemplate) {
      return { available: true, readiness: 'READY' };
    }
    return {
      available: false,
      readiness: 'UNAVAILABLE',
      reason:
        'Zoom requires a configured meeting URL template in Global ChatOps or Service settings.',
    };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;
    const effectiveTemplate =
      input.customTemplate?.trim() || (await resolveGlobalCustomBridgeTemplate());

    const joinUrl = generateBridgeUrl(input.incidentId, 'ZOOM', effectiveTemplate);
    if (!joinUrl) {
      throw new Error(
        'Zoom requires a configured meeting URL template (e.g. https://mycompany.zoom.us/j/123456789 or personal room link).'
      );
    }

    return {
      externalId,
      joinUrl,
      joinWebUrl: joinUrl,
    };
  }
}

/**
 * Google Meet Adapter
 * Requires a configured meeting code or Google Workspace space template.
 * Strict invariant: Never fabricates fake lookup codes.
 */
export class GoogleMeetAdapter implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'GOOGLE_MEET';
  readonly supportsExternalClose = false;

  async isAvailable(customTemplate?: string | null): Promise<MeetingAvailabilityResult> {
    if (customTemplate && customTemplate.trim()) {
      return { available: true, readiness: 'READY' };
    }
    const globalTemplate = await resolveGlobalCustomBridgeTemplate();
    if (globalTemplate) {
      return { available: true, readiness: 'READY' };
    }
    return {
      available: false,
      readiness: 'UNAVAILABLE',
      reason:
        'Google Meet requires a configured meeting URL template in Global ChatOps or Service settings.',
    };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;
    const effectiveTemplate =
      input.customTemplate?.trim() || (await resolveGlobalCustomBridgeTemplate());

    const joinUrl = generateBridgeUrl(input.incidentId, 'GOOGLE_MEET', effectiveTemplate);
    if (!joinUrl) {
      throw new Error(
        'Google Meet requires a configured meeting URL template (e.g. https://meet.google.com/abc-defg-hij).'
      );
    }

    return {
      externalId,
      joinUrl,
      joinWebUrl: joinUrl,
    };
  }
}

/**
 * Singleton Registry for Meeting Providers
 */
export class MeetingProviderRegistry {
  private static adapters: Map<IncidentMeetingProvider, MeetingProviderAdapter> = new Map();

  static {
    this.register(new TeamsMeetingAdapter());
    this.register(new JitsiMeetingAdapter());
    this.register(new ZoomMeetingAdapter());
    this.register(new GoogleMeetAdapter());
  }

  static register(adapter: MeetingProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  static get(provider: IncidentMeetingProvider): MeetingProviderAdapter | null {
    return this.adapters.get(provider) || null;
  }

  static getAdapter(provider: IncidentMeetingProvider): MeetingProviderAdapter | null {
    return this.get(provider);
  }

  static async isAvailable(
    provider: IncidentMeetingProvider,
    customTemplate?: string | null,
    incidentId?: string
  ): Promise<MeetingAvailabilityResult> {
    if (provider === 'NONE') {
      return {
        available: false,
        readiness: 'UNAVAILABLE',
        reason: 'Meeting provider is disabled.',
      };
    }
    const adapter = this.getAdapter(provider);
    if (!adapter) {
      return {
        available: false,
        readiness: 'UNAVAILABLE',
        reason: `No adapter found for provider ${provider}.`,
      };
    }
    return adapter.isAvailable(customTemplate, incidentId);
  }

  static async createOrGetMeeting(
    provider: IncidentMeetingProvider,
    input: CreateOrGetMeetingInput
  ): Promise<MeetingResult> {
    const adapter = this.getAdapter(provider);
    if (!adapter) {
      throw new Error(`Meeting provider ${provider} is not supported.`);
    }
    return adapter.createOrGetMeeting(input);
  }

  static async closeMeeting(
    provider: IncidentMeetingProvider,
    params: CloseMeetingParams
  ): Promise<void> {
    const adapter = this.getAdapter(provider);
    if (adapter?.closeMeeting) {
      await adapter.closeMeeting(params);
    }
  }
}
