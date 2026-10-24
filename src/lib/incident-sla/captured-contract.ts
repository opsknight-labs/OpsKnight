export type CapturedIncidentSlaContract = {
  slaAckTargetMs: number | null | undefined;
  slaResolveTargetMs: number | null | undefined;
  slaTargetSource: string | null | undefined;
  slaTargetCapturedAt: Date | null | undefined;
};

/** Pure provenance validation shared by browser metrics and server projectors. */
export function validateCapturedIncidentSlaContract(
  input: CapturedIncidentSlaContract
): string | null {
  if (!Number.isSafeInteger(input.slaAckTargetMs) || (input.slaAckTargetMs ?? 0) <= 0) {
    return 'Missing or invalid captured ACK target';
  }
  if (!Number.isSafeInteger(input.slaResolveTargetMs) || (input.slaResolveTargetMs ?? 0) <= 0) {
    return 'Missing or invalid captured resolution target';
  }
  if (typeof input.slaTargetSource !== 'string' || !input.slaTargetSource.trim()) {
    return 'Missing or invalid captured target source';
  }
  if (
    !(input.slaTargetCapturedAt instanceof Date) ||
    !Number.isFinite(input.slaTargetCapturedAt.getTime())
  ) {
    return 'Missing or invalid target capture date';
  }
  return null;
}
