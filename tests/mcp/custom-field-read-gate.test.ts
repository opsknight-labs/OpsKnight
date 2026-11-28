import { describe, expect, it } from 'vitest';
import { MCP_OPERATION_MAP, isMcpSensitiveRead } from '@/lib/mcp/catalog';

describe('incident custom-field reads', () => {
  // Values can hold customer data, so listing them needs the same administrator opt-in as the getter.
  it.each(['getIncidentCustomField', 'listIncidentCustomFields'])(
    '%s is a sensitive read behind the opt-in, not a discoverable one',
    operationId => {
      const operation = MCP_OPERATION_MAP.get(operationId)!;
      expect(operation).toMatchObject({ status: 'SENSITIVE_READ', risk: 'R2', tool: null });
      expect(isMcpSensitiveRead(operation)).toBe(true);
    }
  );
});
