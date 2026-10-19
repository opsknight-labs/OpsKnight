/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS entry point packaged in the production image. */
'use strict';
// Isolated fixture only. Refuses an already-upgraded database; never resets data.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const { encode } = require('next-auth/jwt');

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.pathname !== '/enterprise_sso_upgrade_test')
    throw new Error(
      'Only enterprise_sso_upgrade_test is permitted. Create a disposable database first.'
    );
  const baseline = process.env.SSO_UPGRADE_BASELINE || '097f4916a38ddcc6d1512f71b72bde36abbeb171';
  if (!/^[a-f0-9]{40}$/.test(baseline)) throw new Error('Use a full baseline commit hash.');
  const root = process.cwd();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'opsknight-upgrade-'));
  const db = new PrismaClient();
  try {
    const tables =
      await db.$queryRaw`SELECT to_regclass('public."AuthenticationPolicy"')::text AS name`;
    if (tables[0]?.name)
      throw new Error('Fixture is already upgraded; use a new disposable database.');
    const files = execFileSync(
      'git',
      ['ls-tree', '-r', '--name-only', baseline, 'prisma/schema.prisma', 'prisma/migrations'],
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n');
    for (const file of files) {
      if (!file.startsWith('prisma/') || file.includes('..'))
        throw new Error('Invalid baseline path.');
      const target = path.join(temp, file);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Validated repository-relative baseline path inside our private temporary directory.
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Same validated temporary baseline path.
      fs.writeFileSync(target, execFileSync('git', ['show', `${baseline}:${file}`]));
    }
    const run = args => {
      const result = spawnSync('npx', args, { cwd: root, env: process.env, stdio: 'inherit' });
      if (result.status !== 0) throw new Error('Upgrade certification command failed.');
    };
    run(['prisma', 'migrate', 'deploy', '--schema', path.join(temp, 'prisma/schema.prisma')]);
    const encryptionKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
    const encrypted = `${iv.toString('hex')}:${Buffer.concat([cipher.update('legacy-upgrade-client-secret'), cipher.final()]).toString('hex')}`;
    process.env.ENCRYPTION_KEY = encryptionKey.toString('hex');
    process.env.NEXTAUTH_SECRET = crypto.randomBytes(48).toString('base64url');
    // This client is newer than the published v2.0.0 schema being seeded, so columns added since
    // then (for example a resource `revision`) do not exist in the database yet. Prisma's native
    // upsert returns every column, so seed with find + create/update and select only the id.
    const seed = async (model, input) => {
      const where = { id: input.data.id };
      const existing = await model.findUnique({ where, select: { id: true } });
      return existing
        ? model.update({ where, data: input.data, select: { id: true } })
        : model.create({ data: input.data, select: { id: true } });
    };
    const passwordHash = await bcrypt.hash(
      'Existing optional administrator passphrase October 2026',
      12
    );
    await seed(db.user, {
      data: {
        id: 'upgrade-admin',
        email: 'upgrade-admin@example.test',
        name: 'Original administrator',
        role: 'ADMIN',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    await seed(db.user, {
      data: {
        id: 'upgrade-pending',
        email: 'upgrade-pending@example.test',
        name: 'Pending existing user',
        role: 'USER',
        status: 'INVITED',
      },
    });
    await seed(db.team, {
      data: { id: 'upgrade-team', name: 'Existing upgrade team', teamLeadId: 'upgrade-admin' },
    });
    await seed(db.teamMember, {
      data: {
        id: 'upgrade-membership',
        teamId: 'upgrade-team',
        userId: 'upgrade-admin',
        role: 'ADMIN',
      },
    });
    await seed(db.service, {
      data: { id: 'upgrade-service', name: 'Existing upgrade service', teamId: 'upgrade-team' },
    });
    // The generated client also writes columns added after v2.0.0 (for example
    // automationSourceRestricted), so insert only the published-schema columns.
    await db.$executeRaw`
      INSERT INTO "Incident" ("id", "title", "status", "urgency", "visibility", "serviceId", "assigneeId",
        "escalationGeneration", "slaPausedMs", "warRoomProvisioningStatus", "createdAt", "updatedAt")
      VALUES ('upgrade-incident', 'Existing incident history', 'OPEN'::"IncidentStatus",
        'HIGH'::"IncidentUrgency", 'PUBLIC'::"IncidentVisibility", 'upgrade-service', 'upgrade-admin',
        0, 0, 'NONE'::"WarRoomProvisioningStatus", NOW(), NOW())
      ON CONFLICT ("id") DO NOTHING`;
    await seed(db.oidcConfig, {
      data: {
        id: 'default',
        enabled: true,
        issuer: 'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
        clientId: 'legacy-client',
        clientSecret: encrypted,
        configVersion: 7,
        providerType: 'azure',
        updatedBy: 'upgrade-admin',
        autoProvision: false,
        allowedDomains: ['example.test'],
      },
    });
    await seed(db.oidcIdentity, {
      data: {
        id: 'upgrade-identity',
        userId: 'upgrade-admin',
        issuer: 'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
        subject: 'original-subject',
        email: 'upgrade-admin@example.test',
      },
    });
    await seed(db.oidcLinkingApproval, {
      data: {
        id: 'upgrade-approval',
        userId: 'upgrade-pending',
        expectedEmail: 'upgrade-pending@example.test',
        configVersion: 7,
        generation: 4,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const now = Date.now();
    const token = {
      sub: 'upgrade-admin',
      email: 'upgrade-admin@example.test',
      name: 'Original administrator',
      role: 'ADMIN',
      tokenVersion: 0,
      authProvider: 'oidc',
      oidcConfigVersion: 7,
      jti: 'upgrade-session',
      authenticatedAt: now,
      oidcAuthenticatedAt: now,
      lastActivityAt: now,
      sessionExpiresAt: Math.floor(now / 1000) + 3600,
      absoluteExpiresAt: Math.floor(now / 1000) + 7200,
    };
    process.env.SSO_UPGRADE_EXISTING_JWT = await encode({
      token,
      secret: process.env.NEXTAUTH_SECRET,
      maxAge: 3600,
    });
    await db.$executeRaw`INSERT INTO "UserDevice" ("id","userId","deviceId","token","platform","lastUsed","createdAt","updatedAt") VALUES ('upgrade-device','upgrade-admin','session:upgrade-session','{}','WEB_OIDC',NOW(),NOW(),NOW())`;
    process.env.SSO_UPGRADE_ENCRYPTED_SECRET = encrypted;
    console.log(`Existing 2.0 fixture seeded at ${baseline}; applying additive branch migrations.`);
    await db.$disconnect();
    run(['prisma', 'migrate', 'deploy']);
    execFileSync(process.execPath, ['scripts/prepare-authentication-diagnostics.cjs'], {
      stdio: 'inherit',
      env: process.env,
    });
    run([
      'vitest',
      'run',
      '-c',
      'vitest.int.config.ts',
      '--no-file-parallelism',
      'tests/integration/sso-upgrade-database.test.ts',
      ...(process.env.SSO_CERT_AUTH_LOAD === '1'
        ? ['tests/integration/authentication-read-load.test.ts']
        : []),
    ]);
  } finally {
    await db.$disconnect();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
