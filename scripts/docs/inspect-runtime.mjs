import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

export function inspectRuntime() {
  const jobFiles = filesUnder('src/jobs', file => /\.ts$/.test(file));
  const queueSources = filesUnder('src/lib', file => /(?:queue|worker|scheduler)\.ts$/.test(file));
  const queueNames = new Set();
  for (const file of queueSources) {
    for (const match of readRepositoryFile(file).matchAll(/['"]([a-z][a-z0-9_-]*(?:queue|job|worker|scheduler)[a-z0-9_-]*)['"]/gi)) {
      queueNames.add(match[1]);
    }
  }
  return { jobs: jobFiles, queueSources, queueNames: [...queueNames].sort() };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectRuntime(), null, 2));

