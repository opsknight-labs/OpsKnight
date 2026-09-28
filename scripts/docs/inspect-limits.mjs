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
  const limits = [];
  for (const file of files) {
    const source = readRepositoryFile(file);
    for (const match of source.matchAll(/\bconst\s+([A-Z][A-Z0-9_]+)\s*=\s*([^;\n]+)[;\n]/g)) {
      if (!LIMIT_NAME.test(match[1])) continue;
      const value = numericValue(match[2]);
      if (value === null) continue;
      limits.push({ id: `${file}:${match[1]}`, name: match[1], value, expression: match[2].trim(), source: file });
    }
    for (const match of source.matchAll(/maximum of (\d+) ([A-Za-z -]+)/gi)) {
      limits.push({
        id: `${file}:message:${match.index}`,
        name: match[2].trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
        value: Number(match[1]),
        expression: match[0],
        source: file,
      });
    }
  }
  return limits.sort((a, b) => a.id.localeCompare(b.id));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectLimits(), null, 2));
