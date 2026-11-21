import type { SquireState } from './OpsKnightSquire';

export type AiAvailability = 'ready' | 'disabled' | 'quota' | 'unavailable';
export type SquirePresenceInput = {
  online: boolean;
  greeting: boolean;
  busy: boolean;
  speaking: boolean;
  typing: boolean;
  failed: boolean;
  outcome: 'success' | 'error' | null;
  attention: boolean;
  availability: AiAvailability;
};

/** Busy basic answers wake the assistant even when its AI provider is asleep. */
export function squirePresence(input: SquirePresenceInput): { state: SquireState; label: string } {
  if (!input.online) return { state: 'offline', label: 'Offline · reconnect to send' };
  if (input.busy)
    return input.failed
      ? { state: 'error', label: 'Response interrupted' }
      : input.speaking
        ? { state: 'speaking', label: 'Writing a response' }
        : { state: 'thinking', label: 'Investigating' };
  if (input.outcome === 'success') return { state: 'success', label: 'Action completed' };
  if (input.outcome === 'error') return { state: 'error', label: 'Something needs another try' };
  if (input.typing) return { state: 'listening', label: 'Listening' };
  if (input.failed && input.availability !== 'quota')
    return { state: 'error', label: 'Something needs another try' };
  if (input.greeting) return { state: 'greeting', label: 'Here to help you investigate' };
  if (input.attention) return { state: 'alert', label: 'High urgency incident · needs attention' };
  if (input.availability !== 'ready')
    return {
      state: 'offline',
      label:
        input.availability === 'quota'
          ? 'AI limit reached · basic mode available'
          : input.availability === 'unavailable'
            ? 'AI unavailable · basic mode available'
            : 'AI disabled · basic mode available',
    };
  return { state: 'idle', label: 'Ready when you are' };
}
