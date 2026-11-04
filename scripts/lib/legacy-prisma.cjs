/* eslint-disable security/detect-non-literal-fs-filename -- paths are private temporary directories and repository-validated files */
'use strict';
/**
 * Run the Prisma CLI that shipped with an older OpsKnight release.
 *
 * Upgrade certifications apply a previous tag's schema and migrations, then upgrade the same
 * database with the current release. Prisma 7 rejects older schemas (`url` in the datasource)
 * and reads migrations from prisma.config.ts, so the old schema must be applied by the exact
 * Prisma version pinned in that tag's package-lock.json, from an isolated directory.
 */
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function pinnedPrismaVersions(root, tag) {
  const lock = JSON.parse(
    execFileSync('git', ['show', `${tag}:package-lock.json`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  );
  const version = name => lock.packages?.[`node_modules/${name}`]?.version;
  const cli = version('prisma');
  const client = version('@prisma/client');
  if (!/^\d+\.\d+\.\d+$/.test(cli ?? '') || !/^\d+\.\d+\.\d+$/.test(client ?? '')) {
    throw new Error(`Cannot determine the Prisma version pinned by ${tag}.`);
  }
  return { cli, client };
}

/** Install (once per version) and return a runner for the Prisma CLI pinned by `tag`. */
function legacyPrisma(root, tag) {
  const { cli, client } = pinnedPrismaVersions(root, tag);
  const home = path.join(os.tmpdir(), `opsknight-legacy-prisma-${cli}-${client}`);
  const binary = path.join(home, 'node_modules', 'prisma', 'build', 'index.js');
  if (!fs.existsSync(binary)) {
    fs.mkdirSync(home, { recursive: true });
    // `prisma generate` expects both packages to be declared by the surrounding project.
    fs.writeFileSync(
      path.join(home, 'package.json'),
      `${JSON.stringify({
        private: true,
        dependencies: { '@prisma/client': client },
        devDependencies: { prisma: cli },
      })}\n`
    );
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: home, stdio: 'inherit' });
  }
  const runner = {
    version: cli,
    home,
    /**
     * Generate that release's Prisma Client for `schemaPath` and return its directory. The
     * schema is copied into the installation because the generator resolves @prisma/client
     * from the schema's directory.
     */
    generateClient(schemaPath, env = process.env) {
      const directory = fs.mkdtempSync(path.join(home, 'client-'));
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const generator = /generator client\s*\{[^}]*\}/;
      if (!generator.test(schema)) throw new Error('Tagged schema has no client generator.');
      const client = path.join(directory, 'client');
      const copy = path.join(directory, 'schema.prisma');
      fs.writeFileSync(
        copy,
        schema.replace(
          generator,
          `generator client {\n  provider = "prisma-client-js"\n  output = ${JSON.stringify(client)}\n}`
        )
      );
      runner.run(['generate', '--schema', copy], env);
      return client;
    },
    /** Run the pinned CLI from its own directory so prisma.config.ts and .env are not read. */
    run(args, env = process.env) {
      const result = spawnSync(process.execPath, [binary, ...args], {
        cwd: home,
        env: { ...env, PRISMA_HIDE_UPDATE_MESSAGE: '1', PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true' },
        stdio: 'inherit',
      });
      if (result.status !== 0) {
        throw new Error(`prisma ${args[0]} ${args[1] ?? ''} (v${cli}) failed for ${tag}.`);
      }
    },
  };
  return runner;
}

/**
 * Copy `tag`'s prisma/schema.prisma and prisma/migrations into `directory`, generating the
 * client inside the legacy installation so it resolves that release's @prisma/client.
 */
function checkoutTaggedSchema(root, tag, directory) {
  const files = execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', tag, 'prisma/schema.prisma', 'prisma/migrations'],
    { cwd: root, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const file of files) {
    if (!/^prisma\/[A-Za-z0-9_./-]+$/.test(file) || file.includes('..')) {
      throw new Error('Invalid tagged schema path.');
    }
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, execFileSync('git', ['show', `${tag}:${file}`], { cwd: root }));
  }
  return path.join(directory, 'prisma', 'schema.prisma');
}

module.exports = { checkoutTaggedSchema, legacyPrisma, pinnedPrismaVersions };
