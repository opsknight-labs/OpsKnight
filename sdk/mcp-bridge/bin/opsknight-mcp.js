#!/usr/bin/env node
// opsknight-mcp: stdio MCP bridge to a self-hosted OpsKnight server.
//   opsknight-mcp --url https://ops.example.com [--toolsets a,b] [--channel]
//   opsknight-mcp login --url https://ops.example.com [--scope "incidents:read …"] [--client-id ID]
import { parseArgs } from 'node:util';
import {
  BridgeError,
  configPath,
  login,
  oauthAuth,
  patAuth,
  readConfig,
  savedServer,
  serverBase,
} from '../src/auth.js';
import { runBridge } from '../src/bridge.js';

const log = message => process.stderr.write(`opsknight-mcp: ${message}\n`);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      toolsets: { type: 'string' },
      channel: { type: 'boolean' },
      scope: { type: 'string' },
      'client-id': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stderr.write(
      'Usage:\n  opsknight-mcp --url <App URL> [--toolsets a,b] [--channel]\n  opsknight-mcp login --url <App URL> [--scope "…"] [--client-id <id>]\n'
    );
    return 0;
  }
  const rawUrl = values.url ?? process.env.OPSKNIGHT_URL;
  if (!rawUrl) throw new BridgeError('Pass --url <App URL> or set OPSKNIGHT_URL.');
  const base = serverBase(rawUrl);
  const path = configPath();
  if (positionals[0] === 'login') {
    await login({ base, scope: values.scope, clientId: values['client-id'], path, log });
    return 0;
  }
  if (positionals.length) throw new BridgeError(`Unknown command: ${positionals[0]}`);
  if (
    values.toolsets !== undefined &&
    !values.toolsets.split(',').every(name => /^[\w-]+$/.test(name))
  )
    throw new BridgeError(
      '--toolsets takes a comma-separated list of names, such as incidents,oncall.'
    );
  const pat = process.env.OPSKNIGHT_TOKEN?.trim();
  let auth;
  if (pat) {
    if (!pat.startsWith('okmcp_pat_'))
      log('OPSKNIGHT_TOKEN does not look like an OpsKnight personal access token (okmcp_pat_…).');
    auth = patAuth(pat);
  } else if (savedServer(readConfig(path), base)?.refreshToken) auth = oauthAuth(base, path, log);
  else
    throw new BridgeError(
      `No credentials for ${base}. Set OPSKNIGHT_TOKEN or run: opsknight-mcp login --url ${base}`
    );
  process.stdout.on('error', () => process.exit(0));
  await runBridge({
    base,
    auth,
    toolsets: values.toolsets,
    channel: values.channel,
    input: process.stdin,
    output: process.stdout,
    log,
  });
  return 0;
}

main().then(
  code => process.exit(code),
  error => {
    log(
      error instanceof BridgeError || error?.code?.startsWith?.('ERR_PARSE_ARGS')
        ? error.message
        : 'unexpected error'
    );
    process.exit(2);
  }
);
