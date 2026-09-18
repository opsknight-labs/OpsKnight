import type { WarRoomPolicyDecision, WarRoomPolicyInput } from './types';

/** Pure policy: no Prisma, authorization, or provider calls. */
export function evaluateWarRoomPolicy(input: WarRoomPolicyInput): WarRoomPolicyDecision {
  if (!input.config.enabled) return { allowed: false, code: 'CHATOPS_DISABLED' };
  if (!input.config.warRoomsEnabled) return { allowed: false, code: 'WAR_ROOMS_DISABLED' };
  if (!input.destination?.enabled || !input.destination.warRoomEnabled)
    return { allowed: false, code: 'DESTINATION_UNAVAILABLE' };
  if (!input.service.autoCreate && !input.manual)
    return { allowed: false, code: 'SERVICE_DISABLED' };
  if (!input.destination.autoCreate && !input.manual)
    return { allowed: false, code: 'AUTO_CREATE_DISABLED' };

  // Strict confidentiality boundary:
  // If an incident is PRIVATE, the war room must ALWAYS be PRIVATE.
  // Manual requests bypass threshold and auto-create gates, NEVER confidentiality.
  const requested =
    input.incident.visibility === 'PRIVATE'
      ? 'PRIVATE'
      : (input.destination?.membershipType ?? input.config.defaultMembershipType);

  if (input.manual) return { allowed: true, membershipType: requested, reason: 'MANUAL' };
  const matched =
    input.config.autoCreateOnUrgency.includes(input.incident.urgency) ||
    (input.incident.priority !== null &&
      input.config.autoCreateOnPriority.includes(input.incident.priority));
  return matched
    ? { allowed: true, membershipType: requested, reason: 'THRESHOLD' }
    : { allowed: false, code: 'THRESHOLD_NOT_MET' };
}
