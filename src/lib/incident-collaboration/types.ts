/**
 * Canonical Incident Collaboration Domain Contract (Phase 5A)
 *
 * One collaboration model for Slack, Microsoft Teams, and future providers.
 * Server-derived capability, visibility, and state boundaries.
 */

export type WarRoomProviderName = 'SLACK' | 'MICROSOFT_TEAMS';

export type WarRoomProviderAvailability =
  | 'AVAILABLE'
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'PERMISSION_REQUIRED'
  | 'TEMPORARILY_UNAVAILABLE';

export type WarRoomPresentationLifecycle =
  | 'REQUESTED'
  | 'PROVISIONING'
  | 'AMBIGUOUS'
  | 'READY'
  | 'CLOSING'
  | 'CLOSED'
  | 'ARCHIVED'
  | 'FAILED';

export type WarRoomPresentationHealth = 'HEALTHY' | 'DEGRADED' | 'MISSING' | 'PERMISSION_ERROR';

export type WarRoomBadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'destructive';

export type IncidentWarRoomActions = {
  canOpen: boolean;
  canCreate: boolean;
  canClose: boolean;
  canReconcile: boolean;
  canSyncParticipants: boolean;
  canRefreshProjection: boolean;
  canRetryCleanup: boolean;
  canCreateReplacementProjection: boolean;
};

export type IncidentWarRoomParticipantView = {
  id: string;
  userId: string | null;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  source: string;
  state: 'DESIRED' | 'PROCESSING' | 'PENDING' | 'PRESENT' | 'SKIPPED';
  lastError?: string | null;
  addedAt?: string | null;
};

export type IncidentWarRoomView = {
  id: string;
  provider: WarRoomProviderName;
  generation: number;
  state: WarRoomPresentationLifecycle;
  health: WarRoomPresentationHealth;
  channelId: string | null;
  channelName: string | null;
  channelUrl: string | null;
  deepLinkUrl: string | null;
  membershipType: 'STANDARD' | 'PRIVATE' | null;
  createdAt: string;
  readyAt: string | null;
  closedAt: string | null;
  archivedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastReconciledAt: string | null;
  actions: IncidentWarRoomActions;
  participants: {
    synced: number;
    pending: number;
    attentionRequired: number;
    total: number;
    items: IncidentWarRoomParticipantView[];
  };
};

export type IncidentWarRoomHistoryItem = {
  id: string;
  provider: WarRoomProviderName;
  generation: number;
  state: WarRoomPresentationLifecycle;
  health: WarRoomPresentationHealth;
  channelName: string | null;
  channelUrl: string | null;
  deepLinkUrl: string | null;
  membershipType: 'STANDARD' | 'PRIVATE' | null;
  closedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type IncidentWarRoomProviderView = {
  provider: WarRoomProviderName;
  displayName: string;
  subtitle: string;
  availability: WarRoomProviderAvailability;
  visible: boolean;
  canCreate: boolean;
  unavailableReason: string | null;
  currentRoom: IncidentWarRoomView | null;
  historyCount: number;
  history: IncidentWarRoomHistoryItem[];
  supportedOptions: {
    supportsPrivateRooms: boolean;
  };
};

export type IncidentCollaborationSummary = {
  activeRooms: number;
  transitioningRooms: number;
  attentionRequired: number;
  totalHistoricalRooms: number;
};

export type IncidentCollaborationPermissions = {
  canManageWarRooms: boolean;
};

export type IncidentCollaborationView = {
  visible: boolean;
  incidentId: string;
  incidentStatus: string;
  summary: IncidentCollaborationSummary;
  providers: IncidentWarRoomProviderView[];
  history: IncidentWarRoomHistoryItem[];
  permissions: IncidentCollaborationPermissions;
};
