import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MCP_CREDENTIAL_SECURITY_COPY } from '@/components/settings/mcp/credential-security';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';
import { MCP_PROTOCOL_REVISION } from '@/lib/mcp/protocol/revision';
import {
  MCP_GRANT_BLOCK_ERROR,
  grantAccessVerdict,
  mcpGrantBlockError,
  type GrantAccessSnapshot,
} from '@/lib/mcp/auth/effective-access';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed repository paths below
const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('D2 credential security copy', () => {
  it('describes the storage the code actually uses', () => {
    expect(MCP_CREDENTIAL_SECURITY_COPY).not.toMatch(/scrypt|salt|password/i);
    expect(MCP_CREDENTIAL_SECURITY_COPY).toContain('HMAC-SHA256');
    expect(MCP_CREDENTIAL_SECURITY_COPY).toContain('PKCE (S256)');
    expect(MCP_CREDENTIAL_SECURITY_COPY).toMatch(/revokes the whole connection/);
    // The claims hold in the implementation the copy describes.
    expect(source('src/lib/mcp/auth/config.ts')).toMatch(/createHmac\('sha256'/);
    expect(source('src/lib/mcp/auth/config.ts')).not.toMatch(/scrypt/);
    expect(source('src/lib/mcp/auth/oauth-model.ts')).toMatch(/onReuse|reuse/i);
    // The page renders the shared constant instead of its own wording.
    const page = source('src/components/settings/mcp/sections/McpConnectionsSection.tsx');
    expect(page).toContain('{MCP_CREDENTIAL_SECURITY_COPY}');
    expect(page).not.toMatch(/scrypt/i);
  });
});

describe('D6 setup commands', () => {
  const endpoint = "https://ops.example.com/mcp?x='y'";
  const commands = mcpSetupCommands(endpoint, '2.2.0');

  it('builds an "Add to Cursor" link carrying base64 JSON config', () => {
    const url = new URL(commands.cursorInstall);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      'cursor://anysphere.cursor-deeplink/mcp/install'
    );
    expect(url.searchParams.get('name')).toBe('opsknight');
    const config = JSON.parse(Buffer.from(url.searchParams.get('config')!, 'base64').toString());
    expect(config).toEqual({ url: endpoint });
  });

  it('builds an "Add to VS Code" link carrying URL-encoded JSON', () => {
    expect(commands.vscodeInstall.startsWith('vscode:mcp/install?')).toBe(true);
    const json = decodeURIComponent(commands.vscodeInstall.slice('vscode:mcp/install?'.length));
    expect(JSON.parse(json)).toEqual({ name: 'opsknight', type: 'http', url: endpoint });
  });

  it('builds the same link for VS Code Insiders under its own scheme', () => {
    const prefix = 'vscode-insiders:mcp/install?';
    expect(commands.vscodeInsidersInstall.startsWith(prefix)).toBe(true);
    const json = decodeURIComponent(commands.vscodeInsidersInstall.slice(prefix.length));
    expect(JSON.parse(json)).toEqual({ name: 'opsknight', type: 'http', url: endpoint });
    // Fully percent-encoded: nothing in the query can end the link early.
    expect(commands.vscodeInsidersInstall.slice(prefix.length)).not.toMatch(/[ "{}#&?]/);
  });

  it('keeps the shell commands quoted and offers the no-checkout, container and cluster doctor', () => {
    expect(JSON.parse(commands.cursor)).toEqual({ mcpServers: { opsknight: { url: endpoint } } });
    const quoted = `'https://ops.example.com/mcp?x='\\''y'\\'''`;
    // DX-9: downloaded for the running release (never from the instance it diagnoses).
    expect(commands.doctor).toBe(
      `curl -fsSLo opsknight-mcp-doctor.cjs https://raw.githubusercontent.com/opsknight-labs/OpsKnight/v2.2.0/scripts/mcp/doctor.cjs && node opsknight-mcp-doctor.cjs ${quoted}`
    );
    expect(mcpSetupCommands(endpoint, 'v2.3.1').doctor).toContain('/OpsKnight/v2.3.1/');
    expect(commands.doctorSource).toBe(`node scripts/mcp/doctor.cjs ${quoted}`);
    expect(commands.doctorKubernetes).toBe(
      `kubectl exec deploy/<opsknight> -- node scripts/mcp/doctor.cjs ${quoted}`
    );
    expect(commands.codex).toBe(`codex mcp add opsknight --url ${quoted}`);
    expect(commands.geminiCli).toBe(`gemini mcp add --transport http opsknight ${quoted}`);
    expect(commands.doctorDocker).toBe(
      `docker exec <opsknight-container> node scripts/mcp/doctor.cjs 'https://ops.example.com/mcp?x='\\''y'\\'''`
    );
  });
});

describe('DX-9 downloadable doctor', () => {
  it('runs as one file with only Node built-ins, so it works without a checkout', () => {
    const doctor = source('scripts/mcp/doctor.cjs');
    const imports = [...doctor.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    for (const name of imports) expect(name, name).toMatch(/^node:/);
    expect(doctor).toContain('Usage: node opsknight-mcp-doctor.cjs');
  });
});

describe('D6 one protocol revision', () => {
  it('names the served revision once', () => {
    expect(MCP_PROTOCOL_REVISION).toBe('2026-07-28');
    for (const path of [
      'src/app/mcp/route.ts',
      'src/lib/mcp/auth/setup-check.ts',
      'src/components/settings/mcp/sections/McpOverviewSection.tsx',
    ])
      expect(source(path), path).not.toMatch(/['"`]2026-07-28['"`]|MCP 2026-07-28/);
  });
});

describe('D6 copy', () => {
  it('states the 90-day maximum and the real navigation path', () => {
    const overview = source('src/components/settings/mcp/sections/McpOverviewSection.tsx');
    expect(overview).not.toMatch(/Days Sliding/);
    expect(overview).toContain('at most {MCP_ABSOLUTE_SESSION_DAYS} days');
    expect(overview).toContain('Settings → Integrations &amp; ChatOps →');
    expect(source('src/components/settings/mcp/sections/McpConnectSection.tsx')).toContain(
      'MCP_ABSOLUTE_SESSION_DAYS'
    );
    expect(source('src/components/settings/mcp/sections/McpPolicySection.tsx')).not.toMatch(
      /describeScope/
    );
  });
});

describe('D3 grant verdict', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const row = (overrides: Partial<GrantAccessSnapshot> = {}): GrantAccessSnapshot => ({
    grantId: 'g',
    userId: 'u',
    userRevocationVersion: 0,
    grantKind: 'OAUTH',
    grantScopes: ['incidents:read', 'services:read'],
    resource: 'https://ops.example.com/mcp',
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 1000),
    clientScopes: ['incidents:read'],
    clientTrusted: true,
    clientRevokedAt: null,
    policyEnabled: true,
    role: 'USER',
    status: 'ACTIVE',
    mcpRevocationVersion: 0,
    ...overrides,
  });
  const resource = 'https://ops.example.com/mcp';

  it('intersects the approved scopes with the current ceiling', () => {
    expect(grantAccessVerdict(row(), now, resource)).toEqual({
      block: null,
      effectiveScopes: ['incidents:read'],
    });
  });

  it('reports each block in the request path order with its MCP error', () => {
    const cases: [Partial<GrantAccessSnapshot>, string][] = [
      [{ revokedAt: now }, 'ended'],
      [{ expiresAt: now }, 'ended'],
      [{ resource: 'https://elsewhere.example/mcp' }, 'ended'],
      [{ clientRevokedAt: now, clientTrusted: false }, 'client_revoked'],
      [{ clientTrusted: false, status: 'DISABLED' }, 'client_untrusted'],
      [{ status: 'DISABLED', mcpRevocationVersion: 3 }, 'user_inactive'],
      [{ role: 'VIEWER' }, 'user_inactive'],
      [{ mcpRevocationVersion: 1 }, 'access_changed'],
      [{ clientScopes: ['admin:manage'], grantScopes: ['admin:manage'] }, 'admin_scope'],
    ];
    for (const [overrides, block] of cases) {
      const verdict = grantAccessVerdict(row(overrides), now, resource);
      expect(verdict, block).toEqual({ block, effectiveScopes: [] });
    }
    expect(mcpGrantBlockError('access_changed')).toBe('MCP_ACCESS_CHANGED');
    expect(mcpGrantBlockError('user_inactive')).toBe('MCP_INACTIVE_PRINCIPAL');
    expect(Object.keys(MCP_GRANT_BLOCK_ERROR)).toHaveLength(6);
    // Without a configured address the address check is skipped, never guessed.
    expect(grantAccessVerdict(row({ resource: 'x' }), now, null).block).toBeNull();
  });
});
