import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MCP_ERROR_GUIDE,
  MCP_GENERATED_PAGES,
  MCP_LOG_GUIDE,
  MCP_NON_ERROR_CODES,
  renderPermissions,
  renderTroubleshooting,
  scanMcpCodes,
  scanMcpLogEvents,
} from '../../scripts/mcp/docs-reference';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import { MCP_DOCS_LINKS, MCP_DOCS_PATHS } from '@/lib/mcp/docs-links';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';

describe('F3: generated MCP reference pages', () => {
  it.each(MCP_GENERATED_PAGES.map(page => [page.path, page] as const))(
    '%s matches what the code generates (run npm run mcp:docs)',
    (path, page) => {
      expect(readFileSync(path, 'utf8')).toBe(page.render());
    }
  );

  it('explains exactly the MCP codes the source raises', () => {
    const raised = [...scanMcpCodes().keys()].filter(code => !(code in MCP_NON_ERROR_CODES));
    // A new code without an explanation, or an explanation for a code that no longer exists.
    expect(raised.filter(code => !(code in MCP_ERROR_GUIDE))).toEqual([]);
    expect(Object.keys(MCP_ERROR_GUIDE).filter(code => !raised.includes(code))).toEqual([]);
    expect(raised.length).toBeGreaterThan(80);
  });

  it('explains exactly the mcp.* log events the source writes', () => {
    const events = [...scanMcpLogEvents().keys()].sort();
    expect(events).toEqual(Object.keys(MCP_LOG_GUIDE).sort());
    expect(events).toContain('mcp.cimd.client_denied');
    expect(scanMcpLogEvents().get('mcp.tool.unexpected_error')!.level).toBe('error');
  });

  it('takes the people-facing messages and role columns from the code', () => {
    const page = renderTroubleshooting();
    const { title, body } = friendlyMcpError('MCP_ACCESS_CHANGED');
    expect(page).toContain(`| \`MCP_ACCESS_CHANGED\` | ${title} | ${body} |`);
    // The generic tool hint for a page-size error comes from the server's own hint table.
    expect(page).toMatch(
      /\| `MCP_INVALID_PAGE_SIZE` \| query\.limit must be an integer from 1 to 50\. \|/
    );

    const permissions = renderPermissions();
    const row = (scope: string) =>
      permissions.split('\n').find(line => line.startsWith(`| \`${scope}\` |`))!;
    // Responders can approve runbooks; auditors and users cannot.
    expect(mcpScopesUsableByRole('RESPONDER').has('runbooks:approve')).toBe(true);
    expect(
      row('runbooks:approve')
        .split('|')
        .slice(5, 9)
        .map(cell => cell.trim())
    ).toEqual(['✓', '✓', '', '']);
    expect(permissions).not.toContain('`admin:manage` |');
    expect(permissions).toContain(
      'effective scopes = scopes the person ticked on the consent page'
    );
  });

  it('fails the check script when a committed page drifts', () => {
    // The CI entry point must exit non-zero on drift, not only this test.
    const env = {
      ...process.env,
      TS_NODE_PROJECT: 'tsconfig.script.json',
      TS_NODE_TRANSPILE_ONLY: '1',
    };
    const run = () =>
      execFileSync(
        process.execPath,
        [
          '-r',
          'ts-node/register',
          '-r',
          'tsconfig-paths/register',
          'scripts/mcp/generate-docs.ts',
          '--check',
        ],
        { env, encoding: 'utf8', stdio: 'pipe' }
      );
    expect(run()).toContain('Generated MCP docs are current.');
  }, 120_000);
});

describe('F4: MCP docs are findable', () => {
  const mcpPages = execFileSync(
    'git',
    ['ls-files', '--others', '--cached', '--exclude-standard', 'docs/v2.2.0'],
    {
      encoding: 'utf8',
    }
  )
    .split('\n')
    .filter(path => path.endsWith('.md'));

  it('gives every MCP page frontmatter and the frontmatter checker passes on v2.2.0', () => {
    expect(mcpPages.length).toBeGreaterThanOrEqual(12);
    for (const path of mcpPages)
      expect(readFileSync(path, 'utf8'), path).toMatch(/^---\n[\s\S]*?\n---\n/);
    expect(
      execFileSync(process.execPath, ['scripts/docs/check-frontmatter.mjs', 'docs/v2.2.0'], {
        encoding: 'utf8',
      })
    ).toContain('passed');
  });

  it('has an index for each MCP section, a README section and in-app links to real files', () => {
    for (const index of [
      'docs/v2.2.0/guides/mcp/README.md',
      'docs/v2.2.0/operate/mcp/README.md',
      'docs/v2.2.0/reference/mcp/README.md',
    ])
      expect(existsSync(index), index).toBe(true);
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('## 🤖 AI assistants (MCP)');
    expect(readme).toContain('(docs/v2.2.0/guides/mcp/self-hosted-setup.md)');
    for (const key of Object.keys(MCP_DOCS_PATHS) as (keyof typeof MCP_DOCS_PATHS)[]) {
      expect(existsSync(MCP_DOCS_PATHS[key]), MCP_DOCS_PATHS[key]).toBe(true);
      expect(MCP_DOCS_LINKS[key].endsWith(MCP_DOCS_PATHS[key].replace(/^docs\/v2\.2\.0/, ''))).toBe(
        true
      );
    }
    for (const file of [
      'src/components/settings/mcp/McpConnectGuide.tsx',
      'src/components/settings/mcp/sections/McpOverviewSection.tsx',
    ])
      expect(readFileSync(file, 'utf8'), file).toContain('<McpDocsLinks');
    expect(readFileSync('src/app/oauth/mcp/consent/result/page.tsx', 'utf8')).toContain(
      'MCP_DOCS_LINKS.troubleshooting'
    );
  });

  it('marks only Claude Code as verified in the compatibility matrix', () => {
    const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
    const rows = guide
      .split('## Client compatibility')[1]
      .split('\n## ')[0]
      .split('\n')
      .filter(
        line => line.startsWith('| ') && !line.startsWith('| Client') && !line.startsWith('| ---')
      );
    const status = new Map(
      rows.map(
        line =>
          line
            .split('|')
            .map(cell => cell.trim())
            .slice(1, 3) as [string, string]
      )
    );
    expect([...status.keys()]).toEqual([
      'Claude Code',
      'Claude (web and desktop apps)',
      'ChatGPT',
      'Cursor',
      'VS Code',
    ]);
    for (const [client, value] of status)
      expect(value, client).toBe(
        client === 'Claude Code' ? 'Verified' : 'Expected (2025 revisions supported)'
      );
  });

  it('shows the same setup commands as the Connect tab', () => {
    const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
    const commands = mcpSetupCommands('https://ops.your-company.com/mcp');
    expect(guide).toContain(commands.claudeCode);
    expect(guide).toContain(commands.vscode);
    expect(guide).toContain(commands.doctor);
    expect(guide).toContain(commands.doctorDocker);
  });
});

describe('F1/F2: the guides describe current behaviour', () => {
  const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
  const catalog = readFileSync('docs/v2.2.0/reference/mcp/catalog.md', 'utf8');
  const architecture = readFileSync('docs/v2.2.0/operate/mcp/architecture.md', 'utf8');
  const quickstart = readFileSync('docs/v2.2.0/guides/mcp/quickstart.md', 'utf8');

  it('uses the tab and control names the settings page renders', () => {
    const page = readFileSync('src/app/(app)/settings/integrations/mcp/page.tsx', 'utf8');
    const policy = readFileSync(
      'src/components/settings/mcp/sections/McpPolicySection.tsx',
      'utf8'
    );
    const connections = readFileSync(
      'src/components/settings/mcp/sections/McpConnectionsSection.tsx',
      'utf8'
    );
    for (const tab of [
      'Overview',
      'Connect',
      'Assistants',
      'Access policy',
      'Exposed capabilities',
    ])
      expect(page).toContain(`'${tab}'`);
    for (const label of ['Connections', 'Your connections', 'Approvals', 'Runbook approvals'])
      expect(page).toContain(`'${label}'`);
    const labels = [
      'Enable MCP',
      'Automatic connections',
      'What assistants may do',
      'Sign-in sessions',
      'Reviewed actions',
      'Trusted assistant hosts',
      'Workload limits',
      'Time to review',
      'Allow reviewed routine mutations and approved runbook executions',
      'Revoke all active connections',
      'Credential security',
    ];
    for (const label of labels) {
      expect(guide, label).toContain(`**${label}`);
      expect(policy + connections, label).toContain(label);
    }
    // The policy form says who approves what, not that an administrator approves everything.
    expect(policy).not.toContain('Every proposal waits for an administrator');
    expect(policy).toContain('runbook runs wait for anyone with runbook approve permission');
    expect(guide).not.toMatch(
      /\*\*(Your grants|Clients|Client grants|Revoke all MCP connections)\*\*/
    );
  });

  it('states the approval rules, notifications and windows the code enforces', () => {
    expect(guide).toContain(
      'An administrator may approve their own request only after ticking an explicit confirmation'
    );
    expect(guide).toContain('Responders and Administrators by default');
    expect(guide).toContain('There is no email.');
    expect(guide).toContain('default 240 minutes, 15 to 1440');
    expect(guide).toContain('default 30 minutes');
    expect(guide).toContain('Changes to your role or teams do **not** sign you out');
    expect(guide).toContain('restores your previous policy unchanged');
    expect(guide).toContain('It does **not** revoke connections.');
    expect(catalog).not.toContain('for 15 minutes');
    expect(catalog).not.toContain('There is no MCP approval tool');
    expect(architecture).not.toContain('always requires two distinct users');
    expect(architecture).not.toContain('rejects legacy sessions and initialization');
    expect(quickstart).not.toContain('There is no initialize handshake');
    expect(quickstart).not.toContain('The preview expires after five minutes');
    expect(quickstart).not.toContain('separate opt-in trust policy');
  });
});

describe('F5: approval wording guard', () => {
  it('never says only someone other than the requester may approve', () => {
    // An administrator may approve their own request after confirming; the copy must not deny it.
    const result = spawnSync(
      'git',
      [
        'grep',
        '--untracked',
        '-n',
        '-i',
        '-I',
        '-E',
        'other than the requester|cannot approve their own',
        '--',
        'docs',
        'src',
        'README.md',
      ],
      { encoding: 'utf8' }
    );
    // git grep exits 1 when nothing matches, 0 with matches, anything else on error.
    expect(result.stdout).toBe('');
    expect(result.status).toBe(1);
  });
});
