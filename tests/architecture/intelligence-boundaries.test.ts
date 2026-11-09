// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// semver ships with npm and the toolchain; it is only used to compare engine ranges, so load it
// untyped instead of adding a type package to the dependency set.
const { intersects } = createRequire(import.meta.url)('semver') as {
  intersects: (a: string, b: string) => boolean;
};

const root = process.cwd();
const intelligenceDir = join(root, 'src/lib/intelligence');

function sourceFiles(directory: string): string[] {
  // Test-owned paths are rooted under this checkout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  // Test-owned paths are rooted under this checkout.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

// eslint-disable-next-line security/detect-non-literal-fs-filename
const read = (path: string) => readFileSync(path, 'utf8');

describe('intelligence architecture boundaries', () => {
  it('reads no process environment: every setting is database-backed and edited from the UI', () => {
    const offenders = sourceFiles(intelligenceDir).filter(file => /process\.env/.test(read(file)));
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });

  it('keeps the ingestion and incident-creation transactions free of intelligence imports', () => {
    // Stage 0-2 must not change the paging-critical path. A later, separately certified stage may
    // add a single bounded hook from the dedicated ingest-hooks module only. Relative imports
    // ('./intelligence/...') are the same boundary and are checked the same way.
    for (const file of ['src/lib/events.ts', 'src/lib/incidents/creation.ts']) {
      const statements = read(join(root, file)).match(/from\s+['"][^'"]+['"]/g) ?? [];
      const imports = statements.filter(
        statement =>
          /['"]@\/lib\/intelligence/.test(statement) ||
          /['"]\.{1,2}\/[^'"]*intelligence/.test(statement)
      );
      const disallowed = imports.filter(
        statement => !statement.includes('/intelligence/ingest-hooks')
      );
      expect(disallowed, `${file} must not import intelligence internals`).toEqual([]);
    }
  });

  it('keeps similarity, correlation and AI work out of the event outbox and job queue core', () => {
    for (const file of ['src/lib/event-outbox.ts', 'src/lib/jobs/queue.ts']) {
      expect(read(join(root, file))).not.toMatch(/@\/lib\/intelligence/);
    }
  });

  it('confines AI SDK imports to the dedicated AI gateway module', () => {
    const aiDir = join(intelligenceDir, 'ai');
    const offenders = sourceFiles(intelligenceDir)
      .filter(file => !file.startsWith(aiDir))
      .filter(file => /from\s+['"](?:ai|@ai-sdk\/[^'"]+|@openrouter\/[^'"]+)['"]/.test(read(file)));
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });

  it("confines Squire writes to confirmed actions, through the application's own commands", () => {
    const squireDir = join(intelligenceDir, 'squire');
    const executor = join(squireDir, 'actions/execute.ts');
    const writes =
      /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction/;
    // Reading, proposing and answering never write anything.
    const offenders = sourceFiles(squireDir).filter(
      file => file !== executor && writes.test(read(file))
    );
    expect(offenders.map(file => relative(root, file))).toEqual([]);

    // The executor writes only its single-use receipts; every change to an incident goes through the same
    // domain commands (and permission checks) as the application's own buttons.
    const executorSource = read(executor);
    const delegates = [
      ...executorSource.matchAll(
        /\b(?:prisma|tx)\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
      ),
    ].map(match => match[1]);
    expect([...new Set(delegates)]).toEqual(['squireActionReceipt']);
    // A transaction may join the native command to its receipt, but raw SQL and direct
    // incident-table mutations remain forbidden (including through a transaction client).
    expect(executorSource).not.toMatch(/\$executeRaw/);
    expect(executorSource).toContain("isolationLevel: 'Serializable'");
    expect(executorSource).toMatch(/openProposal\(token, actor\.id\)/);

    // Proposal tools are declared in one place and never carry an executor of their own.
    const proposing = sourceFiles(squireDir).filter(file => /PROPOSE_WRITE/.test(read(file)));
    expect(proposing.map(file => relative(root, file))).toEqual([
      'src/lib/intelligence/squire/tools.ts',
    ]);
    const proposalTool =
      read(join(squireDir, 'tools.ts')).match(/function proposalTool[\s\S]*?\n\}/)?.[0] ?? '';
    expect(proposalTool).toContain("kind: 'PROPOSE_WRITE'");
    expect(proposalTool).not.toMatch(/execute/);
  });

  it('lets extended Squire actions reach the application only through its own entry points', () => {
    const squireDir = join(intelligenceDir, 'squire');
    const executor = read(join(squireDir, 'actions/execute.ts'));
    // The only application (src/app) modules the executor may call: the incident page's Jira action and the
    // status page settings route, exactly as their pages do. No other route or page module.
    const appImports = [...executor.matchAll(/import\(\s*'(@\/app\/[^']+)'\s*\)/g)].map(m => m[1]);
    expect([...new Set(appImports)].sort()).toEqual([
      '@/app/(app)/incidents/jira/actions',
      '@/app/api/settings/status-page/announcements/route',
    ]);
    // No other Squire file imports application routes or pages.
    const others = sourceFiles(squireDir).filter(
      file => !file.endsWith('actions/execute.ts') && /['"]@\/app\//.test(read(file))
    );
    expect(others.map(file => relative(root, file))).toEqual([]);
    // The publish step of a status update is never a model tool: tools.ts skips follow-up-only actions.
    expect(read(join(squireDir, 'tools.ts'))).toMatch(
      /FOLLOW_UP_ONLY_ACTIONS\.has\(name\)\) continue;/
    );
    // Every extended action is still a sealed proposal executed only after confirmation.
    expect(executor).toMatch(/isExtendedSquireAction\(proposal\.action\)/);
  });

  it('lets Squire outside the app (chat, MCP) change things only through the sealed proposal executor', () => {
    const chatDir = join(root, 'src/lib/chatops/squire');
    const surfaces = [
      ...sourceFiles(chatDir),
      join(root, 'src/lib/mcp/core/ask-squire.ts'),
      join(root, 'src/lib/mcp/core/ask-squire-contract.ts'),
      join(intelligenceDir, 'squire/surfaces.ts'),
    ];
    expect(sourceFiles(chatDir).length).toBeGreaterThan(3);
    const writes =
      /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction/;
    expect(
      surfaces.filter(file => writes.test(read(file))).map(file => relative(root, file))
    ).toEqual([]);
    // Chat confirms go through the executor; nothing else in chat imports it.
    const executorImports = sourceFiles(chatDir).filter(file =>
      /squire\/actions\/execute['"]/.test(read(file))
    );
    expect(executorImports.map(file => relative(root, file))).toEqual([
      'src/lib/chatops/squire/handler.ts',
    ]);
    // MCP is read-only: it never imports the executor and never hands out a sealed token.
    const mcp = read(join(root, 'src/lib/mcp/core/ask-squire.ts'));
    expect(mcp).not.toMatch(/actions\/execute|executeSquireAction/);
    expect(mcp).not.toMatch(/\.token\b/);
  });

  it('lets assistant support modules write only dialogue state, check templates and feedback', () => {
    const dir = join(intelligenceDir, 'assistant');
    const delegates = sourceFiles(dir).flatMap(file =>
      [
        // Formatting may break a call across lines, so whitespace before the method is allowed.
        ...read(file).matchAll(
          /\b(?:tx|prisma|client|this\.client)\.(\w+)\s*\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
        ),
      ].map(match => match[1])
    );
    expect([...new Set(delegates)].sort()).toEqual([
      'squireCheckTemplate',
      'squireConversation',
      'squireFeedback',
    ]);
    // Dialogue state may only touch the state column of the person's own conversation.
    const state = read(join(dir, 'dialogue-state.ts'));
    expect(state).toMatch(
      /squireConversation\s*\.updateMany\(\{\s*where: \{ id: input\.conversationId, userId: input\.userId \}/
    );
    for (const file of sourceFiles(dir)) expect(read(file)).not.toMatch(/\$executeRaw/);
  });

  it('lets Squire memory write only its own tables, and never the incident timeline', () => {
    const dir = join(intelligenceDir, 'memory');
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    const delegates = files.flatMap(file =>
      [
        ...read(file).matchAll(
          /\b(?:tx|prisma|client)\.(\w+)\s*\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
        ),
      ].map(match => match[1])
    );
    expect([...new Set(delegates)].sort()).toEqual([
      'intelligenceCursor',
      'knowledgeChunk',
      'squireMemorySettings',
      'squireProactiveNote',
      'squireServicePolicy',
    ]);
    for (const file of files) {
      const source = read(file);
      expect(source, relative(root, file)).not.toMatch(/\$executeRaw/);
      // Proactive notes are rendered on the incident page; they never post notes or timeline events.
      expect(source, relative(root, file)).not.toMatch(
        /addIncidentNoteDomainCommand|@\/lib\/incidents\/(?:notes|operator-lifecycle|assignment)/
      );
    }
    // A learned fact exists only through the fact command, which only the confirmed-action executor calls.
    const factWriters = files.filter(file => /knowledgeChunk\s*\.create\(/.test(read(file)));
    expect(factWriters.map(file => relative(root, file))).toEqual([
      'src/lib/intelligence/memory/facts.ts',
    ]);
    const callers = sourceFiles(join(root, 'src')).filter(file =>
      /recordServiceFactCommand\(/.test(read(file))
    );
    expect(callers.map(file => relative(root, file)).sort()).toEqual([
      'src/lib/intelligence/memory/facts.ts',
      'src/lib/intelligence/squire/actions/execute.ts',
    ]);
  });

  it('keeps Squire knowledge tools read-only and every outbound call on the gateway', () => {
    const tools = read(join(intelligenceDir, 'squire/tools-knowledge.ts'));
    expect(tools).not.toMatch(/PROPOSE_WRITE|fetch\(/);
    expect(read(join(intelligenceDir, 'squire/tools.ts'))).toMatch(
      /if \(options\.knowledge\) tools\.push\(\.\.\.buildKnowledgeTools\(actor, options\)\)/
    );
    for (const file of sourceFiles(join(intelligenceDir, 'memory')))
      expect(read(file), relative(root, file)).not.toMatch(/\bfetch\(/);
  });

  it('lets saved assistant conversations write only their own tables', () => {
    const dir = join(intelligenceDir, 'conversations');
    const delegates = sourceFiles(dir).flatMap(file =>
      [
        ...read(file).matchAll(
          /\b(?:tx|prisma)\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
        ),
      ].map(match => match[1])
    );
    expect(delegates.length).toBeGreaterThan(0);
    expect([...new Set(delegates)].sort()).toEqual(['squireConversation', 'squireMessage']);
    for (const file of sourceFiles(dir)) expect(read(file)).not.toMatch(/\$executeRaw/);
  });

  it('lets observability connectors reach the network only through the guarded fetch', () => {
    const dir = join(intelligenceDir, 'connectors');
    const files = sourceFiles(dir);
    expect(files.length).toBeGreaterThan(0);
    const http = join(dir, 'http.ts');
    // Exactly one module builds the fetch, and it delegates to the AI gateway's guarded fetch (SSRF-safe
    // public fetch, or the consented private origin), never to a bare fetch or another HTTP client.
    const httpSource = read(http);
    expect(httpSource).toMatch(/import \{ guardedFetchFor \} from '\.\.\/ai\/gateway'/);
    expect(httpSource).toMatch(/const guarded = guardedFetchFor\(/);
    expect(httpSource).toContain("redirect: 'error'");
    const networkClients =
      /\bfetch\(|globalThis\.fetch|from\s+['"](?:node:)?(?:http|https|net|tls|dgram|undici|axios|node-fetch|got)['"]|\bXMLHttpRequest\b|new\s+WebSocket\b/;
    const offenders = files.filter(file => {
      const source = read(file);
      // http.ts calls only the injected or guarded fetch (`options.fetch(` and `guarded(`).
      const stripped =
        file === http ? source.replace(/options\.fetch\(/g, '').replace(/guarded\(/g, '') : source;
      return networkClients.test(stripped);
    });
    expect(offenders.map(file => relative(root, file))).toEqual([]);
    // The only production fetch an adapter context gets is the guarded one.
    expect(read(join(dir, 'service.ts'))).toMatch(
      /fetch: options\.fetch \?\? connectorFetchFor\(connection\)/
    );
    // Connectors write only their own configuration table, never raw SQL.
    const delegates = files.flatMap(file =>
      [
        ...read(file).matchAll(
          /\b(?:tx|prisma|client)\.(\w+)\s*\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
        ),
      ].map(match => match[1])
    );
    expect([...new Set(delegates)]).toEqual(['observabilityConnection']);
    for (const file of files) expect(read(file)).not.toMatch(/\$executeRawUnsafe|\$queryRawUnsafe/);
    // Squire's observability tools hold no network client of their own: they go through the connectors.
    const tools = read(join(intelligenceDir, 'squire/tools-observability.ts'));
    expect(tools).not.toMatch(networkClients);
    expect(tools).not.toMatch(/connectorFetchFor|guardedFetchFor|safeOutboundFetch/);
  });

  it('routes every AI provider through the guarded fetch', () => {
    const gateway = read(join(intelligenceDir, 'ai/gateway.ts'));
    expect(gateway).toMatch(/const common = \{[^}]*fetch: fetchImpl[^}]*\}/);
    const creators = [
      ...gateway.matchAll(
        /\b(create(?:OpenAICompatible|OpenAI|Anthropic|GoogleGenerativeAI|Azure|AmazonBedrock|Vertex|Mistral|Groq))\(\{/g
      ),
    ];
    expect(creators.map(match => match[1]).sort()).toEqual([
      'createAmazonBedrock',
      'createAnthropic',
      'createAzure',
      'createGoogleGenerativeAI',
      'createGroq',
      'createMistral',
      'createOpenAI',
      'createOpenAICompatible',
      'createVertex',
    ]);
    // The guarded fetch must be the first thing every client is given.
    for (const creator of creators) {
      const opening = gateway.slice(
        creator.index! + creator[0].length,
        creator.index! + creator[0].length + 40
      );
      expect(opening.trimStart().startsWith('...common'), creator[1]).toBe(true);
    }
  });

  it('keeps the shared contract dependency-free so client components can import it', () => {
    const contract = read(join(intelligenceDir, 'contract/index.ts'));
    expect(contract).not.toMatch(
      /(?:from|import)\s+['"](?:@prisma\/client|server-only|@\/lib\/prisma)['"]/
    );
  });

  it('never rewrites incident or alert history from intelligence code', () => {
    const offenders = sourceFiles(intelligenceDir).filter(file =>
      /\b(?:tx|prisma|client)\.(?:incident|alert|incidentEvent|incidentNote)\.(?:update|updateMany|delete|deleteMany|upsert|create|createMany)\b/.test(
        read(file)
      )
    );
    expect(offenders.map(file => relative(root, file))).toEqual([]);
  });
});

describe('Squire investigation and model routing boundaries', () => {
  it('keeps the investigation loop free of data access: it reads only through the tools it is given', () => {
    const dir = join(intelligenceDir, 'squire/investigation');
    const engine = read(join(dir, 'engine.ts'));
    expect(engine).not.toMatch(/from\s+['"](?:@\/lib\/prisma|@prisma\/client|server-only)['"]/);
    expect(engine).not.toMatch(/\bprisma\b/);
    // Only READ tools with an executor are ever run, and never more than four at a time.
    expect(engine).toMatch(/tool\.kind === 'READ' && tool\.execute/);
    expect(engine).toMatch(/maxParallel: 4/);
    for (const file of sourceFiles(dir)) expect(read(file)).not.toMatch(/PROPOSE_WRITE/);
  });

  it('lets incident-response tools only read, through the shared visibility helpers', () => {
    const tools = read(join(intelligenceDir, 'squire/tools-incident.ts'));
    expect(tools).not.toMatch(
      /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$queryRaw|\$transaction/
    );
    expect(tools).toMatch(/readIncidentForActor\(actor/);
    for (const helper of [
      'serviceReadWhere',
      'runbookReadWhere',
      'scheduleReadWhere',
      'incidentReadWhere',
    ])
      expect(tools).toContain(`${helper}(actor)`);
  });

  it('routes capabilities only by reordering the chain the data policy already allowed', () => {
    const gateway = read(join(intelligenceDir, 'ai/gateway.ts'));
    expect(gateway).toMatch(
      /const eligible = selectProviderChain\([\s\S]*?applyCapabilityRoute\(eligible, settings\.capabilityRouting, capability\)/
    );
    const routing = read(join(intelligenceDir, 'ai/routing.ts'));
    expect(routing).toMatch(/const preferred = chain\.find\(/);
    expect(routing).toMatch(/if \(!preferred\) return \[\.\.\.chain\]/);
    // The routing settings writer touches only the AI settings row, under the shared revision lock.
    const writer = read(join(intelligenceDir, 'ai/routing-settings.ts'));
    const delegates = [
      ...writer.matchAll(
        /\btx\.(\w+)\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g
      ),
    ].map(match => match[1]);
    expect([...new Set(delegates)]).toEqual(['aiSettings']);
    expect(writer).toContain("hashtextextended('ai-settings', 0)");
  });
});

describe('runtime compatibility', () => {
  it('only depends on packages that run on the repository Node range', () => {
    // AI SDK 7 requires Node >=22 while the product is pinned to Node 20; this guard keeps any
    // incompatible dependency out until the runtime upgrade is separately certified.
    const pkg = JSON.parse(read(join(root, 'package.json'))) as {
      engines: { node: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const incompatible: string[] = [];
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.optionalDependencies,
    })) {
      const manifestPath = join(root, 'node_modules', name, 'package.json');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(read(manifestPath)) as {
        version: string;
        engines?: { node?: string };
      };
      const range = manifest.engines?.node;
      if (range && !intersects(range, pkg.engines.node)) {
        incompatible.push(`${name}@${manifest.version} requires node ${range}`);
      }
    }
    expect(incompatible).toEqual([]);
  });
});

describe('intelligence data model contracts', () => {
  const schema = read(join(root, 'prisma/schema.prisma'));
  const intelligenceModels = [
    'IncidentFingerprint',
    'CorrelationMember',
    'IncidentRelationship',
    'IntelligenceFinding',
  ];

  function modelBody(name: string): string {
    // Model names come from the fixed list in this test, never from input.
    // eslint-disable-next-line security/detect-non-literal-regexp
    const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`));
    expect(match, `model ${name} must exist`).not.toBeNull();
    return match?.[0] ?? '';
  }

  it('cascades every incident-linked table so retention cleanup can never be blocked', () => {
    for (const name of intelligenceModels) {
      const relations = modelBody(name)
        .split('\n')
        .filter(line => /\bIncident\b.*@relation/.test(line));
      expect(relations.length, `${name} references Incident`).toBeGreaterThan(0);
      for (const line of relations) expect(line).toMatch(/onDelete:\s*Cascade/);
    }
  });

  it('only nulls (never cascades) the correlation group anchor', () => {
    expect(modelBody('CorrelationGroup')).toMatch(
      /anchorIncident\s+Incident\?\s+@relation\([^)]*onDelete:\s*SetNull/
    );
  });

  it('defines the scope-aware correlation identity including policy version and window', () => {
    expect(modelBody('CorrelationGroup')).toMatch(
      /@@unique\(\[policyId, policyVersion, ruleId, scopeHash, signatureHash, windowStart\]/
    );
  });

  it('adds no table partitioning until measurements justify it', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261030000200_intelligence_foundation/migration.sql')
    );
    expect(migration).not.toMatch(/PARTITION\s+BY/i);
  });

  it('makes policy versions and decision events append-only in the database', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261030000200_intelligence_foundation/migration.sql')
    );
    for (const table of [
      'IntelligencePolicyVersion',
      'CorrelationDecisionEvent',
      'IncidentRelationshipEvent',
    ]) {
      // Table names come from the fixed list in this test, never from input.
      const trigger = new RegExp(`CREATE TRIGGER \\w+ BEFORE UPDATE ON "${table}"`); // eslint-disable-line security/detect-non-literal-regexp
      expect(migration).toMatch(trigger);
    }
  });

  it('never lets an unavailable extension fail a deployment', () => {
    const migration = read(
      join(root, 'prisma/migrations/20261030000200_intelligence_foundation/migration.sql')
    );
    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm;\s*EXCEPTION WHEN OTHERS/);
    expect(migration).not.toMatch(/CREATE EXTENSION[^;]*\bvector\b/i);
  });

  it('registers every intelligence table in the privacy registry and processing inventory', () => {
    const schema = read(join(root, 'prisma/schema.prisma'));
    const tables = [
      ...schema.matchAll(
        /^model ((?:Intelligence|Correlation|IncidentFingerprint|AlertFingerprint|DependencyObservation|IncidentEmbedding|IncidentRelationship|ServiceDependency|ChangeEvent|Squire|Knowledge)\w*) \{/gm
      ),
    ].map(match => match[1]);
    expect(tables.length).toBeGreaterThan(10);

    const registry = read(join(root, 'src/lib/privacy/registry.ts'));
    const inventory = read(join(root, 'docs/compliance/data-processing-inventory.yaml'));
    expect(inventory).toContain('domain: intelligence');
    // Settings and the keyset cursor hold no personal data and are intentionally not listed.
    const exempt = new Set(['IntelligenceSettings', 'IntelligencePolicy', 'IntelligenceCursor']);
    const unregistered = tables.filter(
      table => !exempt.has(table) && !registry.includes(`'${table}'`)
    );
    expect(unregistered).toEqual([]);
  });
});
