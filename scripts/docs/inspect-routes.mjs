import { filesUnder, routeFromFile } from './discovery-lib.mjs';

export function inspectRoutes() {
  return filesUnder('src/app', file => /\/page\.tsx$/.test(file)).map(file => ({
    route: routeFromFile(file, 'src/app/'),
    file,
    kind: 'ui',
  }));
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectRoutes(), null, 2));

