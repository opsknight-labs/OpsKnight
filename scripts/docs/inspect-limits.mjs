import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

const LIMIT_NAME = /(?:MAX|MIN|LIMIT|BATCH|CONCURRENCY|TIMEOUT|TTL|WINDOW|BACKOFF|RETRY|RETENTION|POLL)/;

function numericValue(expression) {
  const normalized = expression.replaceAll('_', '').trim();
  if (!/^[\d\s*+\-/().]+$/.test(normalized)) return null;
  try {
    const value = Function(`"use strict"; return (${normalized});`)();
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function inspectLimits() {
  const files = filesUnder('src', file => /\.(?:ts|tsx)$/.test(file));
  const sourceByFile = new Map(files.map(file => [file, readRepositoryFile(file)]));
  const limits = [];
  for (const file of files) {
    const source = sourceByFile.get(file);
    for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*([^;\n]+)[;\n]/g)) {
      if (!LIMIT_NAME.test(match[1])) continue;
      const value = numericValue(match[2]);
      if (value === null) continue;
      const references = files.reduce((count, candidate) => count + (sourceByFile.get(candidate).match(new RegExp(`\\b${match[1]}\\b`, 'g'))?.length ?? 0), 0);
      const classification = /process\.env|env\./.test(source.slice(Math.max(0, match.index - 300), match.index + match[0].length + 300))
        ? 'OPERATOR_TUNABLE'
        : /rate|payload|request|password|token|session|retention|upload/i.test(`${file}:${match[1]}`)
          ? 'SECURITY_OR_PUBLIC_BOUND'
          : /provider|twilio|slack|teams|email|sms|voice|push/i.test(file)
            ? 'PROVIDER_CONSTRAINT'
            : 'INTERNAL_IMPLEMENTATION';
      limits.push({ id: `${file}:${match[1]}`, name: match[1], value, expression: match[2].trim(), source: file, references, semanticClassification: classification });
    }
    for (const match of source.matchAll(/maximum of (\d+) ([A-Za-z -]+)/gi)) {
      limits.push({
        id: `${file}:message:${match.index}`,
        name: match[2].trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: Number(match[1]),
        expression: match[0],
        source: file,
        references: 1,
        semanticClassification: 'PUBLIC_CONTRACT',
      });
    }
  }
  return limits.sort((a, b) => a.id.localeCompare(b.id));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectLimits(), null, 2));
