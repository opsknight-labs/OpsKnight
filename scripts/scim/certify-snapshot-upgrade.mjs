/* eslint-disable security/detect-non-literal-fs-filename -- Only a generated temporary baseline schema is read/written. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(url.pathname, '/enterprise_scim_test');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
const docker =
  process.env.SCIM_CERT_DOCKER ?? '/Applications/Docker.app/Contents/Resources/bin/docker';
const container = process.env.SCIM_CERT_DB_CONTAINER ?? 'opsknight-scim-cert-db';
assert.equal(
  execFileSync(
    docker,
    ['inspect', container, '--format', '{{index .Config.Labels "opsknight.scim.certification"}}'],
    { encoding: 'utf8' }
  ).trim(),
  '20261021'
);
const dbUser = decodeURIComponent(url.username);
const baselineDb = 'scim_upgrade_snapshot_test';
const restoredDb = 'scim_upgrade_restore_test';
const created = [];
const temp = mkdtempSync(join(tmpdir(), 'scim-snapshot-cert-'));
const run = (args, input) =>
  execFileSync(docker, ['exec', '-i', container, ...args], {
    input,
    maxBuffer: 128 * 1024 * 1024,
  });
const sql = (database, input) =>
  run(['psql', '-U', dbUser, '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], input).toString();
try {
  // Never reuse or overwrite a database, even if an earlier rehearsal failed.
  for (const database of [baselineDb, restoredDb]) {
    run(['createdb', '-U', dbUser, database]);
    created.push(database);
  }
  const baselinePath = join(temp, 'schema.prisma');
  writeFileSync(baselinePath, execFileSync('git', ['show', '326f21685:prisma/schema.prisma']));
  const ddl = execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      baselinePath,
      '--script',
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
  sql(
    baselineDb,
    `${ddl}
INSERT INTO "User" (id,name,email,role,"roleSource",status,"scimExternalId","updatedAt")
SELECT 'snapshot-user-'||i, 'Directory '||i, 'snapshot-'||i||'@example.test', 'USER', 'SCIM', 'ACTIVE', 'snapshot-object-'||i, CURRENT_TIMESTAMP FROM generate_series(1,100000) i;
INSERT INTO "User" (id,name,email,role,"roleSource",status,"updatedAt") VALUES ('snapshot-owner','Manual owner','owner@snapshot.example.test','ADMIN','MANUAL','ACTIVE',CURRENT_TIMESTAMP);
INSERT INTO "OidcIdentity" (id,issuer,subject,"userId","updatedAt") SELECT 'snapshot-oidc-'||i,'https://trusted.example.test','subject-'||i,'snapshot-user-'||i,CURRENT_TIMESTAMP FROM generate_series(1,10000) i;
INSERT INTO "Team" (id,name,"scimExternalId","updatedAt") SELECT 'snapshot-team-'||i,'Directory team '||i,'snapshot-group-'||i,CURRENT_TIMESTAMP FROM generate_series(1,10000) i;
INSERT INTO "Team" (id,name,"updatedAt") VALUES ('snapshot-manual-team','Manual operational team',CURRENT_TIMESTAMP);
INSERT INTO "TeamMember" (id,"userId","teamId",role) SELECT 'snapshot-member-'||i,'snapshot-user-'||i,'snapshot-team-'||(((i-1)%10000)+1),'MEMBER' FROM generate_series(1,100000) i;
INSERT INTO "TeamMember" (id,"userId","teamId",role) VALUES ('snapshot-owner-membership','snapshot-owner','snapshot-team-1','OWNER');
INSERT INTO "Service" (id,name,"teamId","updatedAt") VALUES ('snapshot-service','Operational service','snapshot-team-1',CURRENT_TIMESTAMP);
INSERT INTO "SystemConfig" (key,value,"updatedAt") VALUES ('scim_configuration','{"enabled":true,"secretTokenHash":"${hash}"}',CURRENT_TIMESTAMP);
`
  );
  const dump = run(['pg_dump', '-U', dbUser, '-Fc', baselineDb]);
  run(['pg_restore', '-U', dbUser, '--exit-on-error', '--no-owner', '-d', restoredDb], dump);
  const migrations = [
    '20261021100000_scim_identity_lifecycle',
    '20261021150000_scim_provenance_guards',
    '20261021160000_scim_privacy_erasure',
    '20261021170000_scim_profile_authority',
    '20261022100000_scim_grant_revocation_policy',
    '20261022150000_scim_case_insensitive_lookup',
  ]
    .map(name => readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'))
    .join('\n');
  sql(
    restoredDb,
    `BEGIN; ${migrations}
DO $$ BEGIN
 IF (SELECT count(*) FROM "ScimIdentity") <> 100000 THEN RAISE EXCEPTION 'Identity snapshot lost'; END IF;
 IF (SELECT count(*) FROM "ScimGroup") <> 10000 THEN RAISE EXCEPTION 'Group snapshot lost'; END IF;
 IF (SELECT count(*) FROM "ScimGroupMembership") <> 100000 THEN RAISE EXCEPTION 'Membership snapshot lost'; END IF;
 IF (SELECT count(*) FROM "ScimIdentity" WHERE "externalId"='snapshot-object-1' AND "userId"='snapshot-user-1') <> 1 THEN RAISE EXCEPTION 'Immutable identity changed'; END IF;
 IF (SELECT count(*) FROM "ScimGroup" WHERE id='snapshot-team-1' AND "scimExternalId"='snapshot-group-1') <> 1 THEN RAISE EXCEPTION 'Stable group ID lost'; END IF;
 IF (SELECT count(*) FROM "User" WHERE "roleSource"='OIDC') <> 10000 THEN RAISE EXCEPTION 'Role-source repair failed'; END IF;
 IF (SELECT "roleSource" FROM "User" WHERE id='snapshot-owner') <> 'MANUAL' THEN RAISE EXCEPTION 'Manual authority changed'; END IF;
 IF (SELECT count(*) FROM "ScimGroupTeamBinding") <> 0 OR (SELECT count(*) FROM "ScimTeamGrant") <> 0 THEN RAISE EXCEPTION 'Implicit operational authority granted'; END IF;
 IF (SELECT count(*) FROM "TeamMember") <> 100001 OR (SELECT role FROM "TeamMember" WHERE id='snapshot-owner-membership') <> 'OWNER' THEN RAISE EXCEPTION 'Operational memberships changed'; END IF;
 IF (SELECT "teamId" FROM "Service" WHERE id='snapshot-service') <> 'snapshot-team-1' THEN RAISE EXCEPTION 'Service ownership changed'; END IF;
 IF (SELECT value->>'secretTokenHash' FROM "SystemConfig" WHERE key='scim_configuration') <> '${hash}' OR (SELECT "credentialAuthority" FROM "ScimConnector" WHERE id='legacy') <> 'LEGACY' THEN RAISE EXCEPTION 'Legacy credential authority changed during migration'; END IF;
END $$; COMMIT;`
  );
  console.log(
    JSON.stringify({
      syntheticSnapshot: true,
      users: 100000,
      groups: 10000,
      memberships: 100000,
      backupRestore: 'passed',
      stagedUpgrade: 'passed',
      repairedOidcSources: 10000,
      implicitBindings: 0,
      legacyAuthorityPreserved: true,
    })
  );
} finally {
  for (const database of created.reverse()) run(['dropdb', '-U', dbUser, database]);
  rmSync(temp, { recursive: true, force: true });
}
