import { filesUnder, readRepositoryFile } from './discovery-lib.mjs';

export function inspectRuntime() {
  const jobFiles = filesUnder('src/jobs', file => /\.ts$/.test(file));
  const queueSources = filesUnder('src/lib', file => /(?:queue|worker|scheduler)\.ts$/.test(file));
  const workerSource = readRepositoryFile('src/lib/job-worker.ts');
  const laneDeclaration = workerSource.match(/export\s+type\s+JobWorkerLane\s*=\s*([^;]+);/)?.[1] ?? '';
  const workerLanes = [...laneDeclaration.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
  const jobTypes = jobFiles.map(file => file.replace(/^src\/jobs\//, '').replace(/\.ts$/, ''));
  return { jobFiles, jobTypes, queueSources, workerLanes };
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectRuntime(), null, 2));
