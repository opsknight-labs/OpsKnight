// Replays tests/waf/corpus.mjs through the OWASP CRS (ModSecurity + nginx) at each paranoia level, with and
// without the documented exclusions, in front of a stub upstream. Needs Docker. Usage:
//   node tests/waf/run.mjs [--levels=1,2,3] [--out=path.json]
// Exit code 1 when a legitimate request is blocked at any level with the documented exclusions, or a hostile
// request other than the known one passes.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attacks, legit } from './corpus.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.split('=')[1];
const levels = (arg('levels') ?? '1,2,3').split(',').map(Number);
const out = arg('out');
const IMAGE = process.env.WAF_IMAGE ?? 'owasp/modsecurity-crs:nginx';
const UPSTREAM_PORT = 18080;
const WAF_PORT = 18081;
// Hostile requests the CRS does not block at any level and OpsKnight does not act on (it parses no XML).
const KNOWN_UNBLOCKED = new Set(['XXE in an XML body']);
const EXCLUSIONS = resolve(here, 'exclusions/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf');

const docker = (...args) =>
  spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sleep = ms => new Promise(done => setTimeout(done, ms));

const upstream = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
});
await new Promise(done => upstream.listen(UPSTREAM_PORT, '0.0.0.0', done));

// node:http, not fetch, so the Host header is a real host name (a numeric Host is itself a CRS rule, 920350).
function send(request) {
  return new Promise((done, fail) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: WAF_PORT,
        method: request.method,
        path: request.path,
        headers: {
          host: 'opsknight.example.com',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9',
          ...request.headers,
          ...(request.body === undefined
            ? {}
            : { 'content-length': Buffer.byteLength(request.body) }),
        },
      },
      response => {
        response.resume();
        response.on('end', () => done(response.statusCode));
      }
    );
    req.on('error', fail);
    req.end(request.body);
  });
}

async function runLevel(level, withExclusions) {
  const name = `opsknight-waf-pl${level}${withExclusions ? '-ex' : ''}`;
  docker('rm', '-f', name);
  const args = [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-p',
    `${WAF_PORT}:8080`,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-e',
    'PORT=8080',
    '-e',
    `BACKEND=http://host.docker.internal:${UPSTREAM_PORT}`,
    '-e',
    `PARANOIA=${level}`,
    '-e',
    `BLOCKING_PARANOIA=${level}`,
    '-e',
    'ANOMALY_INBOUND=5',
    '-e',
    'ANOMALY_OUTBOUND=4',
    '-e',
    'MODSEC_RULE_ENGINE=On',
    '-e',
    'MODSEC_AUDIT_LOG_FORMAT=JSON',
    // The REST API uses PUT, PATCH and DELETE; the CRS allows only GET HEAD POST OPTIONS by default (rule 911100).
    ...(withExclusions ? ['-e', 'ALLOWED_METHODS=GET HEAD POST OPTIONS PUT PATCH DELETE'] : []),
    '-e',
    'MODSEC_REQ_BODY_LIMIT=2097152',
    '-e',
    'MODSEC_REQ_BODY_NOFILES_LIMIT=2097152',
    ...(withExclusions
      ? [
          '-v',
          `${EXCLUSIONS}:/etc/modsecurity.d/owasp-crs/rules/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf:ro`,
        ]
      : []),
    IMAGE,
  ];
  const started = docker(...args);
  if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);
  for (let i = 0; i < 60; i += 1) {
    try {
      await send({ method: 'GET', path: '/', headers: {} });
      break;
    } catch {
      await sleep(500);
    }
  }
  const snapshot = () => {
    const text = docker('logs', name);
    return { out: text.stdout.split('\n'), err: text.stderr.split('\n') };
  };
  const results = [];
  for (const [kind, list] of [
    ['legit', legit],
    ['attack', attacks],
  ]) {
    for (const request of list) {
      const before = snapshot();
      let status;
      try {
        status = await send(request);
      } catch (error) {
        status = `error: ${error.cause?.code ?? error.message}`;
      }
      let rules = [];
      if (status === 403) {
        await sleep(1200);
        const after = snapshot();
        const added = [
          ...after.out.slice(before.out.length - 1),
          ...after.err.slice(before.err.length - 1),
        ];
        rules = [
          ...new Set(
            added
              .filter(line => line.startsWith('{"transaction"'))
              .flatMap(line => {
                try {
                  const transaction = JSON.parse(line).transaction;
                  return transaction.is_interrupted
                    ? transaction.messages.map(message => message.details.ruleId)
                    : [];
                } catch {
                  return [];
                }
              })
          ),
        ].filter(id => !['949110', '949111', '980130'].includes(id));
      }
      const note =
        status === 403 && rules.length === 0
          ? (
              docker('logs', name)
                .stderr.split('\n')
                .filter(line => line.includes('ModSecurity'))
                .at(-1) ?? ''
            ).slice(0, 300)
          : undefined;
      results.push({ kind, name: request.name, status, blocked: status === 403, rules, note });
    }
  }
  const digest = docker('image', 'inspect', IMAGE, '--format', '{{.Id}}').stdout.trim();
  docker('rm', '-f', name);
  return { level, withExclusions, image: IMAGE, digest, results };
}

const runs = [];
for (const level of levels)
  for (const withExclusions of [false, true]) runs.push(await runLevel(level, withExclusions));
upstream.close();

let failed = false;
for (const run of runs) {
  const legitBlocked = run.results.filter(item => item.kind === 'legit' && item.blocked);
  const attacksPassed = run.results.filter(item => item.kind === 'attack' && !item.blocked);
  console.log(
    `\nPL${run.level} ${run.withExclusions ? 'with documented exclusions' : 'no exclusions'}: ` +
      `${legit.length - legitBlocked.length}/${legit.length} legitimate passed, ` +
      `${attacks.length - attacksPassed.length}/${attacks.length} attacks blocked`
  );
  for (const item of legitBlocked)
    console.log(
      `  BLOCKED  ${item.name}  rules ${item.rules.join(', ') || '?'}${item.note ? `  [${item.note}]` : ''}`
    );
  for (const item of attacksPassed) console.log(`  PASSED   ${item.name} (attack)`);
  if (run.withExclusions && legitBlocked.length) failed = true;
  if (run.withExclusions && attacksPassed.some(item => !KNOWN_UNBLOCKED.has(item.name)))
    failed = true;
}
// eslint-disable-next-line security/detect-non-literal-fs-filename -- the output path comes from the person running the replay
if (out) writeFileSync(out, JSON.stringify(runs, null, 2));
process.exit(failed ? 1 : 0);
