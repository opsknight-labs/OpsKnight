import type { IncidentUrgency, IncidentVisibility } from '@prisma/client';

export type WarRoomProviderName = 'SLACK' | 'MICROSOFT_TEAMS';
export type WarRoomMembership = 'STANDARD' | 'PRIVATE';

export type WarRoomPolicyInput = {
  incident: { urgency: IncidentUrgency; priority: string | null; visibility: IncidentVisibility };
  service: { autoCreate: boolean };
  destination: { enabled: boolean; warRoomEnabled: boolean; autoCreate: boolean; membershipType: WarRoomMembership | null } | null;
  config: { enabled: boolean; warRoomsEnabled: boolean; autoCreateOnUrgency: readonly string[]; autoCreateOnPriority: readonly string[]; defaultMembershipType: WarRoomMembership };
  manual: boolean;
};

export type WarRoomPolicyDecision =
  | { allowed: true; membershipType: WarRoomMembership; reason: 'MANUAL' | 'THRESHOLD' }
  | { allowed: false; code: 'CHATOPS_DISABLED' | 'WAR_ROOMS_DISABLED' | 'DESTINATION_UNAVAILABLE' | 'SERVICE_DISABLED' | 'AUTO_CREATE_DISABLED' | 'THRESHOLD_NOT_MET' | 'PRIVATE_DOWNGRADE_DENIED' };

export type WarRoomGraphFailureCode =
  | 'RATE_LIMITED'
  | 'MISSING_PERMISSION'
  | 'TEAM_NOT_FOUND'
  | 'CHANNEL_NOT_FOUND'
  | 'MEMBER_NOT_IN_TEAM'
  | 'AMBIGUOUS_CREATE'
  | 'TRANSIENT_READ'
  | 'DUPLICATE_WAR_ROOMS'
  | 'GRAPH_TOKEN_FAILED'
  | 'UNKNOWN';

export type WarRoomGraphResult<T> = { ok: true; value: T } | { ok: false; code: WarRoomGraphFailureCode; message: string; retryAfterMs?: number };
