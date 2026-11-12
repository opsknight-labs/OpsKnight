import { readFileSync } from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

/**
 * server.json is the Official MCP Registry entry (not published from CI). It is validated against a
 * vendored snapshot of the registry schema, fetched from the URL in the snapshot's own `$id`
 * (https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json). When the
 * registry moves to a new schema date, replace the snapshot and the `$schema` line together.
 */
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths below
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const serverJson = read('server.json');
const schema = read('tests/mcp/fixtures/mcp-registry-server.schema.json');
const pkg = read('package.json');

describe('MCP Registry server.json', () => {
  it('validates against the vendored registry schema it names', () => {
    expect(serverJson.$schema).toBe(schema.$id);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(serverJson), JSON.stringify(validate.errors)).toBe(true);
  });

  it('tracks the package version and repository', () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(pkg.repository.url).toContain(serverJson.repository.url.replace('https://', ''));
  });

  it('describes one remote per installation, with the host as a required variable', () => {
    expect(serverJson.remotes).toHaveLength(1);
    const [remote] = serverJson.remotes;
    expect(remote.type).toBe('streamable-http');
    expect(remote.url).toBe('https://{host}/mcp');
    expect(remote.variables.host.isRequired).toBe(true);
    // OAuth is the default; a static bearer header is optional and must be treated as a secret.
    expect(remote.headers).toEqual([
      expect.objectContaining({ name: 'Authorization', isRequired: false, isSecret: true }),
    ]);
  });
});
