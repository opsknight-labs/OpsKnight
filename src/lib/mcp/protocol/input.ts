import { z } from 'zod/v3';
import { requireMcp } from '../core/errors';
import { readBoundedMcpText } from '../core/body';

export const rpcSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string().max(128), z.number().int()]),
    method: z.string().min(1).max(128),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export function rejectDuplicateJsonKeys(text: string) {
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const character = text.charAt(i);
    if (character === '{') stack.push(new Set());
    else if (character === '[') stack.push(null);
    else if (character === '}' || character === ']') stack.pop();
    else if (character === '"') {
      const start = i++;
      for (; i < text.length; i++) {
        if (text.charAt(i) === '\\') i++;
        else if (text.charAt(i) === '"') break;
      }
      let next = i + 1;
      while (/\s/.test(text.charAt(next)) && next < text.length) next++;
      if (text.charAt(next) === ':') {
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        const keys = stack.at(-1);
        requireMcp(
          keys && !keys.has(key) && !['__proto__', 'prototype', 'constructor'].includes(key),
          'MCP_DUPLICATE_OR_UNSAFE_KEY'
        );
        keys.add(key);
      }
    }
    requireMcp(stack.length <= 24, 'MCP_JSON_DEPTH');
  }
}

export async function readMcpBody(request: Request) {
  requireMcp(
    request.headers.get('content-type')?.split(';')[0] === 'application/json',
    'MCP_CONTENT_TYPE',
    415
  );
  const text = await readBoundedMcpText(request, 65536);
  rejectDuplicateJsonKeys(text);
  return rpcSchema.parse(JSON.parse(text));
}
