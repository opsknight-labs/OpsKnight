import { readRepositoryFile } from './discovery-lib.mjs';

export function inspectDatabase() {
  const source = readRepositoryFile('prisma/schema.prisma');
  const names = pattern => [...source.matchAll(pattern)].map(match => match[1]).sort();
  return {
    source: 'prisma/schema.prisma',
    models: names(/^model\s+(\w+)\s*\{/gm),
    enums: names(/^enum\s+(\w+)\s*\{/gm),
  };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectDatabase(), null, 2));

