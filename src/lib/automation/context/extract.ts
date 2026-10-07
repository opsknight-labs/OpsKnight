/* eslint-disable security/detect-object-injection -- Paths reject prototype and sensitive keys and use own-property reads only. */
import { LIMITS, type CompiledField, type Context } from '../contract';
import { normalizeValue } from './normalize';
export const forbiddenSegment = (key: string): boolean => /authorization|cookie|password|secret|token|signature|integration.?key|api.?key|credential/i.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key);
export function compilePath(path: string): Array<string | number> {
  const cleaned = path.replace(/^\$\.?/, '');
  const segments = cleaned.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (!segments.length || segments.some(t => !/^[A-Za-z_][\w-]*$/.test(t) && !/^\d+$/.test(t)) || /^\d/.test(segments[0])) throw new Error('Invalid extraction path');
  const tokens = cleaned.replace(/\[(\d+)\]/g, '.$1').split('.').map(t => /^\d+$/.test(t) ? Number(t) : t);
  if (tokens.length > LIMITS.depth || tokens.some(t => typeof t === 'string' && forbiddenSegment(t))) throw new Error('Unsafe extraction path');
  return tokens;
}
export function readCompiledPath(payload: unknown, tokens: Array<string | number>): unknown {
  let value = payload;
  for (const token of tokens) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, token)) return undefined;
    value = (value as Record<string | number, unknown>)[token];
  }
  return value;
}
export function extractContext(input: { providerPayload: unknown; normalizedEvent: unknown; integrationType: string; fields: CompiledField[] }): Context {
  if (input.fields.length > LIMITS.fields) throw new Error('CONTEXT_FIELD_LIMIT');
  const context: Context = {};
  for (const field of input.fields) {
    let raw: unknown;
    for (const mapping of field.mappings) {
      if (mapping.integrationType && mapping.integrationType !== input.integrationType) continue;
      const candidate = readCompiledPath(mapping.source === 'PROVIDER' ? input.providerPayload : input.normalizedEvent, mapping.pathTokens);
      if (candidate !== undefined && candidate !== null && candidate !== '') { raw = candidate; break; }
    }
    context[field.key] = normalizeValue(raw, field);
  }
  return context;
}
