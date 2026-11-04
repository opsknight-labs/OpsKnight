// Minimal OpenID Connect provider for the local SSO journey test (tests/e2e/sso-journey.spec.ts).
// Never deploy it. It signs whoever was last chosen through GET /as?user=<json>.
//
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 \
//     -subj /CN=idp.example.test -addext subjectAltName=DNS:idp.example.test,DNS:localhost
//   MOCK_OIDC_CERT_DIR=<dir with key.pem and cert.pem> node tests/e2e/fixtures/mock-oidc-provider.mjs
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../package.json', import.meta.url));
const { SignJWT, exportJWK } = require('jose');
const certDir = process.env.MOCK_OIDC_CERT_DIR ?? new URL('.', import.meta.url).pathname;
const port = 3443;
const issuer = process.env.MOCK_OIDC_ISSUER ?? `https://idp.example.test:${port}`;
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
let nextUser = { sub: 'sub-admin', email: 'admin@acme-sso.test', groups: ['ops-admins'] };
const codes = new Map();
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
// eslint-disable-next-line security/detect-non-literal-fs-filename -- Test-only fixture reading its own certificate directory.
createServer({ key: readFileSync(certDir + '/key.pem'), cert: readFileSync(certDir + '/cert.pem') }, async (req, res) => {
  const url = new URL(req.url, issuer);
  if (url.pathname === '/.well-known/openid-configuration')
    return json(res, {
      issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['openid', 'email', 'profile', 'groups'], end_session_endpoint: `${issuer}/logout`,
    });
  if (url.pathname === '/jwks') return json(res, { keys: [jwk] });
  if (url.pathname === '/as') { // test control: choose who signs in next
    nextUser = JSON.parse(url.searchParams.get('user'));
    return json(res, { ok: true, nextUser });
  }
  if (url.pathname === '/authorize') {
    const code = randomBytes(16).toString('hex');
    codes.set(code, { nonce: url.searchParams.get('nonce'), user: nextUser, clientId: url.searchParams.get('client_id') });
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code); back.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: back.href }); return res.end();
  }
  if (url.pathname === '/token') {
    let body = ''; for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    const entry = codes.get(params.get('code')); codes.delete(params.get('code'));
    if (!entry) return json(res, { error: 'invalid_grant' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const idToken = await new SignJWT({ email_verified: true, name: entry.user.email.split('@')[0], ...entry.user, nonce: entry.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(issuer).setAudience(entry.clientId)
      .setIssuedAt(now).setExpirationTime(now + 600).sign(privateKey);
    return json(res, { access_token: createHash('sha256').update(params.get('code')).digest('hex'), token_type: 'Bearer', expires_in: 600, id_token: idToken });
  }
  if (url.pathname === '/logout') { res.writeHead(302, { location: url.searchParams.get('post_logout_redirect_uri') || '/login' }); return res.end(); }
  json(res, { error: 'not_found' }, 404);
}).listen(port, () => console.log('idp ready', issuer));
