import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

export const repositoryRoot = resolve(import.meta.dirname, '../..');

export function filesUnder(directory, predicate = () => true) {
  const absolute = resolve(repositoryRoot, directory);
  const files = [];
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (predicate(path)) files.push(relative(repositoryRoot, path));
    }
  };
  visit(absolute);
  return files.sort();
}

export function readRepositoryFile(path) {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

export function exists(path) {
  try {
    statSync(resolve(repositoryRoot, path));
    return true;
  } catch {
    return false;
  }
}

export function routeFromFile(file, prefix) {
  const route = file
    .replace(prefix, '')
    .replace(/\/(page|route)\.tsx?$/, '')
    .split('/')
    .filter(segment => !/^\(.+\)$/.test(segment))
    .join('/');
  return `/${route}`.replace(/\/$/, '') || '/';
}

