import { filesUnder, readRepositoryFile, routeFromFile } from './discovery-lib.mjs';

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function inspectApi() {
  return filesUnder('src/app/api', file => /\/route\.ts$/.test(file)).map(file => {
    const source = readRepositoryFile(file);
    return {
      route: routeFromFile(file, 'src/app'),
      file,
      methods: methods.filter(method => new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b|export\\s+const\\s+${method}\\b`).test(source)),
    };
  });
}

if (process.argv[1] === import.meta.filename) console.log(JSON.stringify(inspectApi(), null, 2));

