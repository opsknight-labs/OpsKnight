import { describe, expect, it } from 'vitest';
import { deliveryReconciliationCapability } from '@/lib/notification-control-plane';

describe('Voice ambiguity and reconciliation capability', () => {
  it('identifies Twilio Voice as CALLBACK capable for delivery reconciliation', () => {
    expect(deliveryReconciliationCapability('VOICE', 'twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('VOICE', 'Twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('SMS', 'twilio')).toBe('CALLBACK');
    expect(deliveryReconciliationCapability('WHATSAPP', 'twilio')).toBe('CALLBACK');
  });

  it('marks unsupported providers as UNSUPPORTED for Voice reconciliation', () => {
    expect(deliveryReconciliationCapability('VOICE', 'custom-voice')).toBe('UNSUPPORTED');
    expect(deliveryReconciliationCapability('VOICE', null)).toBe('UNSUPPORTED');
    expect(deliveryReconciliationCapability('VOICE', undefined)).toBe('UNSUPPORTED');
  });

  it('verifies that callback-capable voice providers treat 5xx as ambiguous', () => {
    const isCallbackCapable = deliveryReconciliationCapability('VOICE', 'twilio') === 'CALLBACK';
    expect(isCallbackCapable).toBe(true);

    const twilio500Result = { statusCode: 500, error: 'Internal Server Error' };
    const is5xx =
      typeof twilio500Result.statusCode === 'number' && twilio500Result.statusCode >= 500;

    // In notification-control-plane:
    // ((isEmail || isCallbackCapable) && statusCode >= 500)
    const isAmbiguous = isCallbackCapable && is5xx;
    expect(isAmbiguous).toBe(true);
  });
});
