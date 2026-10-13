export interface ApiV2Pagination {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface ApiV2SuccessEnvelope<T> {
  data: T;
  pagination?: ApiV2Pagination;
  requestId: string;
  timestamp: string;
}

export interface ApiV2ValidationErrorField {
  field: string;
  code: string;
  message: string;
}

export interface ApiV2ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  requestId: string;
  timestamp: string;
  retryable: boolean;
  fields?: ApiV2ValidationErrorField[];
  meta?: Record<string, unknown>;
}

export interface ApiV2CursorPayload {
  id: string;
  createdAt: string;
}
