// Business strings are data, never instructions. Redaction applies recursively,
// including error and resource responses. No bearer values are included in evidence.
import { sanitizeOutputText } from '../../../../agent/src/output-safety';

const sensitive =
  /(?:secret|password|token|credential|authorization|api.?key|signed.?url|email|phone|payload|rawOutput|stdout|stderr)|^(?:definition|config|inputValues|executionPlan|environment|env)$/i;
export function projectMcpData(
  value: unknown,
  redacted: string[] = [],
  path = '',
  depth = 0
): unknown {
  if (depth > 24) {
    redacted.push(path);
    return '[REDACTED_DEPTH]';
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      projectMcpData(item, redacted, `${path}/${index}`, depth + 1)
    );
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => {
        const field = `${path}/${key}`;
        if (sensitive.test(key)) {
          redacted.push(field);
          return [key, '[REDACTED]'];
        }
        return [key, projectMcpData(child, redacted, field, depth + 1)];
      })
    );
  }
  if (typeof value === 'string') {
    // Suppress bearer material and URLs that may convey credential access.
    const safe = sanitizeOutputText(value)
      .replace(/\b(?:Bearer\s+\S+|ok_[A-Za-z0-9_-]{16,})/gi, '[REDACTED]')
      .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
        try {
          const url = new URL(raw);
          return url.username || url.password || url.search ? '[REDACTED_URL]' : raw;
        } catch {
          return '[INVALID_URL]';
        }
      });
    if (safe !== value) redacted.push(path);
    return safe;
  }
  return value;
}
