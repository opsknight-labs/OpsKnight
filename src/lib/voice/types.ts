export interface VoiceCallRequest {
  to: string;
  from: string;
  message: string;
  notificationId: string;
  incidentId?: string;
  userId?: string;
  escalationGeneration?: number;
  requireAck?: boolean;
}

export interface VoiceCallResult {
  success: boolean;
  callSid?: string;
  providerMessageId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
  statusCode?: number;
  retryAfterMs?: number;
  retryable?: boolean;
}
