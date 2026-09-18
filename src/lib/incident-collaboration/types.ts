/**
 * Canonical Incident Collaboration Domain Contract (Phase 5A)
 *
 * One collaboration model for Slack, Microsoft Teams, and future providers.
 * Server-derived capability, visibility, and state boundaries.
 */

export type WarRoomProviderName = 'SLACK' | 'MICROSOFT_TEAMS' | (string & {});

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

export type WarRoomProviderSet = WarRoomProviderName[];

export type IncidentMeetingProvider = 'MICROSOFT_TEAMS' | 'ZOOM' | 'GOOGLE_MEET' | 'JITSI' | 'NONE';

export type IncidentMeetingState =
  | 'REQUESTED'
  | 'PROVISIONING'
  | 'READY'
  | 'CLOSING'
  | 'CLOSED'
  | 'FAILED';

export type IncidentMeetingHealth = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';

export type IncidentMeetingReadiness =
  | 'READY'
  | 'CONFIGURED'
  | 'ORGANIZER_REQUIRED'
  | 'PERMISSION_REQUIRED'
  | 'UNAVAILABLE';

export type IncidentMeetingActions = {
  canJoin: boolean;
  canRetry: boolean;
  canClose: boolean;
  canProvision: boolean;
  supportsExternalClose?: boolean;
  closeLabel?: string;
};

export type IncidentMeetingView = {
  id: string;
  incidentId: string;
  generation: number;
  provider: IncidentMeetingProvider;
  state: IncidentMeetingState;
  health: IncidentMeetingHealth;
  externalId: string;
  joinUrl: string;
  joinWebUrl?: string | null;
  conferenceId?: string | null;
  tollNumber?: string | null;
  organizerEmail?: string | null;
  providerMeetingId?: string | null;
  createdAt: string;
  readyAt?: string | null;
  closedAt?: string | null;
  closeStartedAt?: string | null;
  closeToken?: string | null;
  cleanupAttemptedAt?: string | null;
  cleanupRetryCount?: number;
  lastReconciledAt?: string | null;
  externalCleanupPending?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  actions: IncidentMeetingActions;
  readiness?: IncidentMeetingReadiness;
};

export type MeetingOperationalHealth =
  | 'HEALTHY'
  | 'DEGRADED'
  | 'UNAVAILABLE'
  | 'DRIFTED'
  | 'UNKNOWN';

export type MeetingOperationalSnapshot = {
  resourceType: 'MEETING';
  incidentId: string;
  meetingId: string;
  provider: IncidentMeetingProvider;
  generation: number;
  state: IncidentMeetingState;
  health: MeetingOperationalHealth;
  cleanupPending: boolean;
  provisionJobState?: string | null;
  closeJobState?: string | null;
  lastReconciledAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  createdAt: string;
  readyAt?: string | null;
  closedAt?: string | null;
};

export type ServiceWarRoomPolicy = {
  serviceProviders: WarRoomProviderSet | null;
  meetingProvider?: IncidentMeetingProvider | null;
  warRoomsEnabled: boolean;
  autoCreate: boolean;
};

export type GlobalWarRoomPolicy = {
  enabled: boolean;
  defaultProviders: WarRoomProviderSet;
  defaultMeetingProvider: IncidentMeetingProvider;
  autoCreateOnUrgency?: string[];
  autoCreateOnPriority?: string[];
  archiveOnResolve?: boolean;
};

export type IncidentWarRoomProviderView = {
  provider: WarRoomProviderName;
  displayName: string;
  subtitle: string;
  availability: WarRoomProviderAvailability;
  visible: boolean;
  canCreate: boolean;
  enabledForService: boolean;
  destinationAvailable: boolean;
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
  canManageMeeting: boolean;
};

export type IncidentCollaborationView = {
  visible: boolean;
  incidentId: string;
  incidentStatus: string;
  summary: IncidentCollaborationSummary;
  providers: IncidentWarRoomProviderView[];
  meeting: IncidentMeetingView | null;
  history: IncidentWarRoomHistoryItem[];
  permissions: IncidentCollaborationPermissions;
};
