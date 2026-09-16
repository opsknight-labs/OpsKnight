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
import type { IncidentMeetingProvider } from './types';
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

export interface MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider;
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult>;
  closeMeeting?(meetingId: string): Promise<void>;
}

/**
 * Microsoft Teams Native Online Meeting Adapter
 * Uses Microsoft Graph /users/{userId}/onlineMeetings/createOrGet with deterministic idempotency key.
 */
export class TeamsMeetingAdapter implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'MICROSOFT_TEAMS';

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

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const resolved = await getMicrosoftTeamsConfig();
      if (!resolved || !resolved.config.enabled) {
        return {
          available: false,
          reason: 'Microsoft Teams integration is disabled or unconfigured.',
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
          reason: 'No Microsoft Entra tenant ID configured for Microsoft Teams.',
        };
      }

      return { available: true };
    } catch (e) {
      return {
        available: false,
        reason: (e as Error).message || 'Failed to verify Microsoft Teams availability.',
      };
    }
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

  async isAvailable(): Promise<{ available: boolean }> {
    return { available: true };
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

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;

    const joinUrl = generateBridgeUrl(input.incidentId, 'ZOOM', input.customTemplate);
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

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    return { available: true };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    const generation = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${generation}`;

    const joinUrl = generateBridgeUrl(input.incidentId, 'GOOGLE_MEET', input.customTemplate);
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

  static getAdapter(provider: IncidentMeetingProvider): MeetingProviderAdapter | null {
    return this.adapters.get(provider) || null;
  }

  static async isAvailable(
    provider: IncidentMeetingProvider
  ): Promise<{ available: boolean; reason?: string }> {
    if (provider === 'NONE') {
      return { available: false, reason: 'Meeting provider is disabled.' };
    }
    const adapter = this.getAdapter(provider);
    if (!adapter) {
      return { available: false, reason: `No adapter found for provider ${provider}.` };
    }
    return adapter.isAvailable();
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
}
