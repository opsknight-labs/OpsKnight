import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync as fsExists, readFileSync as fsRead } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MCP_ERROR_GUIDE,
  MCP_GENERATED_PAGES,
  MCP_LOG_GUIDE,
  MCP_NON_ERROR_CODES,
  fillGeneratedBlocks,
  redactedFieldRule,
  renderCatalogCounts,
  renderSecurityBlocks,
  renderPermissions,
  renderTroubleshooting,
  scanMcpCodes,
  scanMcpLogEvents,
} from '../../scripts/mcp/docs-reference';
import { renderTools } from '../../scripts/mcp/docs-tools';
import { MCP_CAPABILITIES, MCP_PROMPT_NAMES } from '@/lib/mcp/catalog/capabilities';
import { MCP_CATALOG } from '@/lib/mcp/catalog';
import { projectMcpData } from '@/lib/mcp/core/projection';
import { friendlyMcpError } from '@/lib/mcp/auth/friendly-error';
import { mcpScopesUsableByRole } from '@/lib/mcp/auth/role-scopes';
import {
  MCP_DOCS_LINKS,
  MCP_DOCS_PATHS,
  MCP_DOCS_REPOSITORY,
  MCP_DOCS_SITE,
  mcpDocsHref,
  mcpTroubleshootingLink,
} from '@/lib/mcp/docs-links';
import { mcpSetupCommands } from '@/components/settings/mcp/setup-commands';
import {
  MCP_APPROVAL_ABSOLUTE_MAX_MS,
  MCP_APPROVAL_COMMIT_WINDOW_DEFAULT_MINUTES,
  MCP_APPROVAL_TTL_DEFAULT_MINUTES,
  MCP_APPROVAL_TTL_MAX_MINUTES,
  MCP_APPROVAL_TTL_MIN_MINUTES,
} from '@/lib/mcp/approvals/timing';
import { MCP_ABSOLUTE_SESSION_DAYS, MCP_DEFAULT_IDLE_DAYS } from '@/lib/mcp/auth/session-lifetime';

// Repository paths only: generated pages, checked-in docs and source files named in this test.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const readFileSync = (path: string, encoding: 'utf8') => fsRead(path, encoding);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repository paths only
const existsSync = (path: string) => fsExists(path);

describe('F3: generated MCP reference pages', () => {
  it.each(MCP_GENERATED_PAGES.map(page => [page.path, page] as const))(
    '%s matches what the code generates (run npm run mcp:docs)',
    async (path, page) => {
      expect(readFileSync(path, 'utf8')).toBe(await page.render());
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

  it('gives every code its own anchor, and error pages link to it (DX-2)', () => {
    const page = renderTroubleshooting();
    const raised = [...scanMcpCodes().keys()].filter(code => !(code in MCP_NON_ERROR_CODES));
    for (const code of raised) expect(page, code).toContain(`<a id="${code}"></a>\`${code}\``);
    for (const event of scanMcpLogEvents().keys())
      expect(page, event).toContain(`<a id="${event}"></a>`);
    expect(mcpTroubleshootingLink('invalid_client')).toBe(
      `${MCP_DOCS_LINKS.troubleshooting}#invalid_client`
    );
    expect(readFileSync('src/lib/mcp/auth/friendly-error.ts', 'utf8')).toContain(
      'mcpTroubleshootingLink(code)'
    );
  });

  it('documents every tool the server offers and every prompt, from the live tool list (DX-6)', async () => {
    const page = await renderTools('2026-11-04');
    const standalone = MCP_CAPABILITIES.filter(capability => capability.kind === 'tool');
    for (const tool of standalone) expect(page, tool.id).toContain(`### \`${tool.id}\``);
    for (const tool of new Set(
      MCP_CATALOG.flatMap(operation => (operation.tool ? [operation.tool] : []))
    ))
      expect(page, tool).toContain(`### \`${tool}\``);
    for (const prompt of MCP_PROMPT_NAMES) expect(page, prompt).toContain(`| \`${prompt}\` |`);
    // Hints and requirements come from the server: a change tool says it needs changes on.
    expect(page).toMatch(
      /### `incident_resolve`[\s\S]*?\| no \| [^|]+ \| [^|]+ \| `incidents:write` \| Changes \|/
    );
  });

  it('states the real status of every operation that is not available', () => {
    const rows = renderPermissions()
      .split('\n')
      .filter(line => line.includes('| not available'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect(row).not.toMatch(/eligible|approval batch|needs |review .*projection/);
    expect(rows.find(row => row.includes('`createReportExport`'))).toContain(
      'not exposed, reason recorded in the catalog'
    );
    expect(rows.find(row => row.includes('`createServiceAccount`'))).toContain(
      'restricted to native administration'
    );
  });

  it('keeps the catalog counts and the coverage table in step with the registry (DX-12)', () => {
    const catalog = readFileSync('docs/v2.2.0/reference/mcp/catalog.md', 'utf8');
    const counts = renderCatalogCounts();
    for (const [name, text] of counts)
      expect(catalog).toContain(`<!-- generated:${name} -->${text}<!-- /generated:${name} -->`);
    expect(counts.get('mcp-counts')).toContain(`${MCP_CATALOG.length} classified operations`);
    expect(() => fillGeneratedBlocks('no markers', counts)).toThrow('Missing generated block');
    const total = renderPermissions()
      .split('\n')
      .find(line => line.startsWith('| **All** |'))!
      .split('|')
      .slice(2, 6)
      .map(value => Number(value.trim()));
    expect(total[0]).toBe(MCP_CATALOG.length);
    expect(total[1] + total[2] + total[3]).toBe(total[0]);
  });

  it('lists exactly the fields the projection removes, and every listed field is removed (DX-5)', () => {
    const page = readFileSync('docs/v2.2.0/guides/mcp/security-and-data.md', 'utf8');
    for (const [name, text] of renderSecurityBlocks())
      expect(page).toContain(`<!-- generated:${name} -->${text}<!-- /generated:${name} -->`);
    const { contains, exact } = redactedFieldRule();
    expect(contains).toContain('password');
    expect(exact).toContain('environment');
    for (const field of [
      ...contains.map(value => `my${value.replace(/\.\?/g, '_')}Value`),
      ...exact,
    ])
      expect(projectMcpData({ [field]: 'x' }), field).toEqual({ [field]: '[REDACTED]' });
    expect(projectMcpData({ title: 'x' })).toEqual({ title: 'x' });
    expect(page).toContain('Secrets typed into free text are not detected.');
  });

  it('documents that call_operation refuses reads, with no removal release left over (DX-7)', () => {
    const catalog = readFileSync('docs/v2.2.0/reference/mcp/catalog.md', 'utf8');
    expect(catalog).toContain('`call_operation` serves routine changes only');
    expect(catalog).not.toContain('still serves reads');
    expect(readFileSync('CHANGELOG.md', 'utf8')).not.toContain('reads through `call_operation`');
    expect(readFileSync('src/lib/mcp/protocol/server.ts', 'utf8')).toContain(
      'version: APP_VERSION'
    );
  });

  it('names only real tools, prompts and codes in the hand-written guides (DX-4, DX-10)', async () => {
    const page = await renderTools('2026-11-04');
    const known = new Set(
      [...page.matchAll(/^### `([a-z_]+)`/gm), ...page.matchAll(/^\| `([a-z_]+)` \|/gm)].map(
        match => match[1]
      )
    );
    const codes = new Set(scanMcpCodes().keys());
    for (const file of [
      'docs/v2.2.0/guides/mcp/what-to-ask.md',
      'docs/v2.2.0/guides/mcp/build-an-agent.md',
    ]) {
      const text = readFileSync(file, 'utf8');
      for (const [, name] of text.matchAll(/`([a-z_]+)`/g))
        if (/[a-z]_[a-z]/.test(name)) expect(known, `${file}: ${name}`).toContain(name);
      for (const [, code] of text.matchAll(/`(MCP_[A-Z_]+)`/g))
        expect(codes.has(code), `${file}: ${code}`).toBe(true);
    }
    // Every built-in prompt has at least one example request.
    const ask = readFileSync('docs/v2.2.0/guides/mcp/what-to-ask.md', 'utf8');
    for (const prompt of MCP_PROMPT_NAMES) expect(ask, prompt).toContain(`\`${prompt}\` prompt`);
    expect(ask).toContain('`assigneeId: "me"`');
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

  it('derives every docs link from its path, in either published form (DX-1)', () => {
    for (const path of Object.values(MCP_DOCS_PATHS)) {
      expect(mcpDocsHref(path, false)).toBe(`${MCP_DOCS_REPOSITORY}/${path}`);
      const site = mcpDocsHref(path, true);
      // Swapping the base must not keep the .md suffix: the docs site serves slugs.
      expect(site.startsWith(`${MCP_DOCS_SITE}/v2.2.0/`), site).toBe(true);
      expect(site.endsWith('/'), site).toBe(true);
      expect(site).not.toContain('.md');
    }
    expect(MCP_DOCS_REPOSITORY).toBe('https://github.com/opsknight-labs/OpsKnight/blob/main');
    for (const [key, link] of Object.entries(MCP_DOCS_LINKS))
      expect(
        Object.values(MCP_DOCS_PATHS).some(
          path => link === mcpDocsHref(path, false) || link === mcpDocsHref(path, true)
        ),
        key
      ).toBe(true);
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
    const links = new Map(Object.entries(MCP_DOCS_LINKS));
    for (const [key, path] of Object.entries(MCP_DOCS_PATHS)) {
      expect(existsSync(path), path).toBe(true);
      expect(links.get(key)?.endsWith(path.replace(/^docs\/v2\.2\.0/, ''))).toBe(true);
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

  const compatibility = () => {
    const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
    const rows = guide
      .split('## Client compatibility')[1]
      .split('\n## ')[0]
      .split('\n')
      .filter(
        line => line.startsWith('| ') && !line.startsWith('| Client') && !line.startsWith('| ---')
      );
    return new Map(
      rows.map(
        line =>
          line
            .split('|')
            .map(cell => cell.trim())
            .slice(1, 3) as [string, string]
      )
    );
  };

  it('lists every client the Connect tab covers, none verified without recorded evidence', () => {
    const status = compatibility();
    expect([...status.keys()]).toEqual([
      'Claude Code',
      'Claude (web and desktop apps)',
      'ChatGPT',
      'Cursor',
      'VS Code',
      'Codex CLI',
      'Gemini CLI',
      'Windsurf',
      'API-hosted agents',
    ]);
    for (const client of ['Codex CLI', 'Gemini CLI', 'Windsurf'])
      expect(status.get(client), client).toBe('Expected (not verified)');
    for (const client of ['Claude (web and desktop apps)', 'ChatGPT', 'Cursor', 'VS Code'])
      expect(status.get(client), client).toBe('Expected (2025 revisions supported)');
    // API-hosted agents depend on each provider's connector, so they are not claimed as expected.
    expect(status.get('API-hosted agents')).toBe('Not verified');
  });

  it('ties every Tested or Verified status to a recorded live checkpoint (CERT-05)', () => {
    const certification = readFileSync('docs/v2.2.0/operate/mcp/certification.md', 'utf8');
    const checkpoint = certification.split('## Live client checkpoint')[1]?.split('\n## ')[0];
    expect(checkpoint).toBeTruthy();
    const entries = checkpoint!.split('\n### ').slice(1);
    const CHECKS = [
      'Registration',
      'Consent',
      'tools/list',
      'Scoped read',
      'Refresh',
      'Role change',
      'Revocation',
    ];
    let evidenced = 0;
    for (const [client, value] of compatibility()) {
      const tested = /^Tested \((v\d+\.\d+\.\d+), (\d{4}-\d{2}-\d{2})\)$/.exec(value);
      const verified = /^Verified \((.+) (\d+\.\d+\.\d+), (\d{4}-\d{2}-\d{2})\)$/.exec(value);
      if (value.startsWith('Expected') || value === 'Not verified') continue;
      expect(tested ?? verified, `${client}: "${value}" names no version and date`).toBeTruthy();
      if (tested) {
        const [, version, date] = tested;
        expect(
          entries.some(entry => entry.split('\n')[0].includes(version) && entry.includes(date)),
          `${client}: no checkpoint for ${version} on ${date}`
        ).toBe(true);
      } else {
        const [, , version, date] = verified!;
        const entry = entries.find(
          candidate => candidate.includes(version) && candidate.includes(date)
        );
        expect(entry, `${client}: no checkpoint for ${version} on ${date}`).toBeTruthy();
        expect(entry).toMatch(/\b[0-9a-f]{40}\b/);
        // The negotiated MCP revision.
        expect(entry).toMatch(/revision[^\n]*(?:2025-06-18|2025-11-25|2026-07-28)/i);
        for (const check of CHECKS)
          expect(entry!.includes(`- ${check}: pass`), `${client}: ${check}`).toBe(true);
      }
      evidenced++;
    }
    // Claude Code carries recorded evidence; nothing else claims any.
    expect(evidenced).toBe(1);
  });

  it('shows the same setup commands as the Connect tab', () => {
    const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
    const commands = mcpSetupCommands('https://ops.your-company.com/mcp', '2.2.0');
    for (const command of [
      commands.claudeCode,
      commands.vscode,
      commands.codex,
      commands.codexLogin,
      commands.geminiCli,
      commands.doctor,
      commands.doctorSource,
      commands.doctorDocker,
      commands.doctorKubernetes,
    ])
      expect(guide).toContain(command);
    // The no-checkout doctor comes first: it works from a laptop outside the network.
    expect(guide.indexOf(commands.doctor)).toBeLessThan(guide.indexOf(commands.doctorSource));
  });
});

describe('F1/F2: the guides describe current behaviour', () => {
  const guide = readFileSync('docs/v2.2.0/guides/mcp/self-hosted-setup.md', 'utf8');
  const catalog = readFileSync('docs/v2.2.0/reference/mcp/catalog.md', 'utf8');
  const architecture = readFileSync('docs/v2.2.0/operate/mcp/architecture.md', 'utf8');
  const quickstart = readFileSync('docs/v2.2.0/operate/mcp/contributing.md', 'utf8');

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

  it('quotes the numbers the code enforces, so a changed limit fails until the guide follows', () => {
    // Read from the enforcing source, not restated here: the guide is the thing under test.
    const constant = (file: string, pattern: RegExp) => {
      const match = readFileSync(file, 'utf8').match(pattern);
      expect(match, `${file} ${pattern}`).not.toBeNull();
      return Number(match![1]);
    };
    const notifyLimit = constant(
      'src/lib/mcp/approvals/notify.ts',
      /MCP_APPROVAL_NOTIFY_LIMIT = (\d+);/
    );
    const reasonMax = constant(
      'src/lib/mcp/approvals/operation.ts',
      /decisionReasonSchema = z\.string\(\)\.trim\(\)\.max\((\d+)\)/
    );
    const freshHours = constant(
      'src/lib/auth-control/actor.ts',
      /FRESH_AUTHENTICATION_MAX_AGE_MS = (\d+) \* 60 \* 60 \* 1000;/
    );
    const consentMs = constant(
      'src/app/oauth/mcp/authorize/route.ts',
      /expiresAt: new Date\(Date\.now\(\) \+ (\d+)\)/
    );
    expect(guide).toContain(
      `(default ${MCP_APPROVAL_TTL_DEFAULT_MINUTES} minutes, ${MCP_APPROVAL_TTL_MIN_MINUTES} to ${MCP_APPROVAL_TTL_MAX_MINUTES})`
    );
    expect(guide).toContain(
      `(default ${MCP_APPROVAL_COMMIT_WINDOW_DEFAULT_MINUTES} minutes), never later than ${MCP_APPROVAL_ABSOLUTE_MAX_MS / 3_600_000} hours after the request`
    );
    expect(guide).toContain(`At most ${notifyLimit} people are notified`);
    expect(guide).toContain(`(up to ${reasonMax} characters)`);
    expect(guide).toContain(
      `a sign-in within the last ${freshHours === 2 ? 'two' : freshHours} hours`
    );
    expect(consentMs).toBe(5 * 60_000);
    expect(guide).toContain('The page expires after five minutes.');
    expect(guide).toContain(
      `(1 to ${MCP_ABSOLUTE_SESSION_DAYS} days, default ${MCP_DEFAULT_IDLE_DAYS})`
    );
    expect(guide).toContain(`always after ${MCP_ABSOLUTE_SESSION_DAYS} days in total`);
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
