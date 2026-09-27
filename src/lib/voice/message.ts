import { decodeNotificationEnvelope } from '@/lib/notification-payload';

function concise(value: string | null | undefined, fallback: string, max = 140): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, max);
}

export function buildIncidentVoiceMessage(durableMessage: string): string {
  try {
    const envelope = decodeNotificationEnvelope(durableMessage);
    if (!envelope) throw new Error('Missing notification snapshot');
    const snapshot = envelope.snapshot;
    const urgency = concise(snapshot.urgency, 'High').toLowerCase();
    return `${urgency} priority incident. Service: ${concise(snapshot.service.name, 'Unknown service', 80)}. Incident: ${concise(snapshot.title, 'An incident requires attention')}.`;
  } catch {
    return 'Incident requires your attention.';
  }
}
