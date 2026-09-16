/**
 * Deterministic Collaboration Provider Fault Injector & Test Harness
 *
 * Implements Workstream D & Section 7 of Phase 6:
 * Configures deterministic behaviors across Slack, Teams, and Native Meetings
 * (429, 401/403, 404, 5xx, timeouts, lost responses, and worker crashes).
 */

import { WarRoomRetryableError } from '@/lib/war-room/errors';
import {
  MeetingProviderRegistry,
  TeamsMeetingAdapter,
  type MeetingProviderAdapter,
  type CreateOrGetMeetingInput,
  type MeetingResult,
  type CloseMeetingParams,
  type MeetingAvailabilityResult,
} from '@/lib/incident-collaboration/meeting-registry';
import type { IncidentMeetingProvider } from '@/lib/incident-collaboration/types';

export type ProviderFaultBehavior =
  | 'SUCCESS'
  | 'RATE_LIMITED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'TIMEOUT'
  | 'NETWORK_FAILURE'
  | 'SERVER_ERROR'
  | 'SUCCESS_THEN_TIMEOUT'
  | 'SUCCESS_THEN_WORKER_CRASH'
  | 'DELAYED_SUCCESS';

export interface BehaviorConfig {
  behavior: ProviderFaultBehavior;
  retryAfterMs?: number;
  statusCode?: number;
  errorMessage?: string;
  delayMs?: number;
}

export class MockMeetingProviderHarness implements MeetingProviderAdapter {
  readonly provider: IncidentMeetingProvider = 'MICROSOFT_TEAMS';
  readonly supportsExternalClose = true;

  private createBehavior: BehaviorConfig = { behavior: 'SUCCESS' };
  private closeBehavior: BehaviorConfig = { behavior: 'SUCCESS' };

  public createCalls: CreateOrGetMeetingInput[] = [];
  public closeCalls: CloseMeetingParams[] = [];
  public externalMeetings: Map<string, MeetingResult> = new Map();
  public deletedMeetingIds: Set<string> = new Set();

  setCreateBehavior(config: BehaviorConfig | ProviderFaultBehavior): void {
    this.createBehavior = typeof config === 'string' ? { behavior: config } : config;
  }

  setCloseBehavior(config: BehaviorConfig | ProviderFaultBehavior): void {
    this.closeBehavior = typeof config === 'string' ? { behavior: config } : config;
  }

  reset(): void {
    this.createBehavior = { behavior: 'SUCCESS' };
    this.closeBehavior = { behavior: 'SUCCESS' };
    this.createCalls = [];
    this.closeCalls = [];
    this.externalMeetings.clear();
    this.deletedMeetingIds.clear();
  }

  async isAvailable(): Promise<MeetingAvailabilityResult> {
    if (this.createBehavior.behavior === 'PERMISSION_DENIED') {
      return {
        available: false,
        readiness: 'PERMISSION_REQUIRED',
        reason: 'Missing Graph permissions (OnlineMeetings.ReadWrite.All)',
      };
    }
    return { available: true, readiness: 'READY' };
  }

  async createOrGetMeeting(input: CreateOrGetMeetingInput): Promise<MeetingResult> {
    this.createCalls.push(input);
    const gen = input.generation ?? 1;
    const externalId = `opsknight:${input.incidentId}:${gen}`;

    // Handle Ambiguous External Success / Lost Response (Workstream F)
    if (this.createBehavior.behavior === 'SUCCESS_THEN_TIMEOUT') {
      // First call creates external meeting, but throws timeout to client
      if (!this.externalMeetings.has(externalId)) {
        const meeting: MeetingResult = {
          externalId,
          joinUrl: `https://teams.microsoft.com/l/meetup-join/lost-response-${input.incidentId}-${gen}`,
          providerMeetingId: `ext-teams-${input.incidentId}-${gen}`,
          organizerEmail: 'organizer@example.com',
        };
        this.externalMeetings.set(externalId, meeting);
        throw new WarRoomRetryableError('Request timed out while waiting for Graph response', 1000);
      }
      // Subsequent retry retrieves the created meeting idempotently!
      return this.externalMeetings.get(externalId)!;
    }

    if (this.createBehavior.behavior === 'RATE_LIMITED') {
      throw new WarRoomRetryableError(
        'Rate limited by Microsoft Graph (429)',
        this.createBehavior.retryAfterMs ?? 45000
      );
    }

    if (this.createBehavior.behavior === 'PERMISSION_DENIED') {
      throw new Error('403 Forbidden: Missing OnlineMeetings.ReadWrite.All permission');
    }

    if (this.createBehavior.behavior === 'TIMEOUT') {
      throw new WarRoomRetryableError('Graph API request timed out', 5000);
    }

    if (this.createBehavior.behavior === 'NETWORK_FAILURE') {
      throw new WarRoomRetryableError('fetch failed: ECONNRESET', 2000);
    }

    if (this.createBehavior.behavior === 'SERVER_ERROR') {
      throw new WarRoomRetryableError('503 Service Unavailable', 5000);
    }

    if (this.createBehavior.delayMs) {
      await new Promise(r => setTimeout(r, this.createBehavior.delayMs));
    }

    // Default SUCCESS
    if (!this.externalMeetings.has(externalId)) {
      this.externalMeetings.set(externalId, {
        externalId,
        joinUrl: `https://teams.microsoft.com/l/meetup-join/${input.incidentId}-${gen}`,
        providerMeetingId: `ext-teams-${input.incidentId}-${gen}`,
        organizerEmail: 'organizer@example.com',
      });
    }

    return this.externalMeetings.get(externalId)!;
  }

  async closeMeeting(params: CloseMeetingParams): Promise<void> {
    this.closeCalls.push(params);

    if (this.closeBehavior.behavior === 'RATE_LIMITED') {
      throw new WarRoomRetryableError(
        'Rate limited during meeting close (429)',
        this.closeBehavior.retryAfterMs ?? 30000
      );
    }

    if (this.closeBehavior.behavior === 'NOT_FOUND') {
      // 404: external meeting is already gone -> idempotent success!
      if (params.providerMeetingId) {
        this.deletedMeetingIds.add(params.providerMeetingId);
      }
      return;
    }

    if (this.closeBehavior.behavior === 'PERMISSION_DENIED') {
      throw new Error('403 Forbidden: Missing permission to delete online meeting');
    }

    if (this.closeBehavior.behavior === 'SERVER_ERROR') {
      throw new WarRoomRetryableError('500 Internal Server Error', 5000);
    }

    if (this.closeBehavior.behavior === 'NETWORK_FAILURE') {
      throw new WarRoomRetryableError('Network connection reset during DELETE', 2000);
    }

    // Default SUCCESS (204)
    if (params.providerMeetingId) {
      this.deletedMeetingIds.add(params.providerMeetingId);
    }
  }
}

export class MockWarRoomProviderHarness {
  private provisionBehavior: BehaviorConfig = { behavior: 'SUCCESS' };
  private closeBehavior: BehaviorConfig = { behavior: 'SUCCESS' };
  public provisionCalls: Array<Record<string, unknown>> = [];
  public closeCalls: Array<Record<string, unknown>> = [];

  setBehavior(config: BehaviorConfig | ProviderFaultBehavior): void {
    this.provisionBehavior = typeof config === 'string' ? { behavior: config } : config;
  }

  setCloseBehavior(config: BehaviorConfig | ProviderFaultBehavior): void {
    this.closeBehavior = typeof config === 'string' ? { behavior: config } : config;
  }

  getProvisionBehavior(): BehaviorConfig {
    return this.provisionBehavior;
  }

  getCloseBehavior(): BehaviorConfig {
    return this.closeBehavior;
  }

  reset(): void {
    this.provisionBehavior = { behavior: 'SUCCESS' };
    this.closeBehavior = { behavior: 'SUCCESS' };
    this.provisionCalls = [];
    this.closeCalls = [];
  }
}

export class CollaborationProviderHarness {
  public meeting = new MockMeetingProviderHarness();
  public slack = new MockWarRoomProviderHarness();
  public teamsRoom = new MockWarRoomProviderHarness();

  install(): void {
    MeetingProviderRegistry.register(this.meeting);
  }

  restore(): void {
    this.meeting.reset();
    this.slack.reset();
    this.teamsRoom.reset();
    // Restore default TeamsMeetingAdapter
    MeetingProviderRegistry.register(new TeamsMeetingAdapter());
  }

  reset(): void {
    this.meeting.reset();
    this.slack.reset();
    this.teamsRoom.reset();
  }
}

export const collaborationProviderHarness = new CollaborationProviderHarness();
