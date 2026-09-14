import type { WarRoomProviderName } from './types';

export type ProviderFailureCode =
  | 'RATE_LIMITED'
  | 'AUTH_FAILED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'AMBIGUOUS_SIDE_EFFECT'
  | 'TRANSIENT'
  | 'DUPLICATE_RESOURCE'
  | 'UNSUPPORTED'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'TERMINAL';

export type ProviderOperationResult<T> =
  | { ok: true; value: T; providerOperationId?: string }
  | {
      ok: false;
      code: ProviderFailureCode;
      message: string;
      retryAfterMs?: number;
      providerCode?: string;
      providerDetails?: Record<string, unknown>;
    };

export type WarRoomProviderCapabilities = {
  createRoom: boolean;
  privateRooms: boolean;
  manageMembers: boolean;
  updateRoom: boolean;
  archiveRoom: boolean;
  interactiveProjection: boolean;
  projectionUpdates: boolean;
  reconciliation: boolean;
};

/**
 * Provider boundary used by the neutral runtime. The orchestration methods are
 * deliberately lifecycle-free: adapters execute provider work while durable
 * generations, leases, retries, and policy remain owned by the engine/domain.
 * Teams initially delegates to its proven implementation; later commits move
 * the individual transport operations behind the capability methods.
 */
export interface WarRoomProviderAdapter {
  readonly provider: WarRoomProviderName;
  readonly capabilities: WarRoomProviderCapabilities;

  provision(warRoomId: string, provisioningToken: string): Promise<void>;
  project(warRoomId: string, projectionVersion: number): Promise<void>;
  syncParticipants(warRoomId: string): Promise<void>;
  settleProjectionFailure(warRoomId: string, projectionVersion: number): Promise<void>;
}

export class UnsupportedWarRoomProviderOperationError extends Error {
  constructor(provider: WarRoomProviderName, operation: string) {
    super(`${provider} war-room adapter does not support ${operation}.`);
    this.name = 'UnsupportedWarRoomProviderOperationError';
  }
}
