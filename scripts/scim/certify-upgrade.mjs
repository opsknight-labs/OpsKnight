/* eslint-disable security/detect-non-literal-fs-filename -- All files are confined to a generated temporary directory. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (url.pathname !== '/enterprise_scim_test') throw new Error('Use enterprise_scim_test.');
const docker =
  process.env.SCIM_CERT_DOCKER ?? '/Applications/Docker.app/Contents/Resources/bin/docker';
const container = process.env.SCIM_CERT_DB_CONTAINER ?? 'opsknight-scim-cert-db';
if (container !== 'opsknight-scim-cert-db')
  throw new Error('Only the dedicated SCIM fixture container is permitted.');
const baseline = process.env.SCIM_BASELINE_COMMIT ?? '326f21685';
const temp = mkdtempSync(join(tmpdir(), 'opsknight-scim-upgrade-'));
try {
  const schemaPath = join(temp, 'schema.prisma');
  writeFileSync(schemaPath, execFileSync('git', ['show', `${baseline}:prisma/schema.prisma`]));
  const ddl = execFileSync(
    'npx',
    ['prisma', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'],
    { encoding: 'utf8' }
  );
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
  const sql = `BEGIN; CREATE SCHEMA scim_upgrade_cert; SET LOCAL search_path TO scim_upgrade_cert;\n${ddl}\n
INSERT INTO "User" (id,name,email,role,"roleSource",status,"scimExternalId","updatedAt") VALUES ('owner','Owner','owner@upgrade.example.test','ADMIN','MANUAL','ACTIVE',NULL,CURRENT_TIMESTAMP),('directory-user','Directory user','directory@upgrade.example.test','ADMIN','SCIM','ACTIVE','directory-object',CURRENT_TIMESTAMP);
INSERT INTO "OidcIdentity" (id,issuer,subject,"userId","updatedAt") VALUES ('oidc','https://trusted.example.test','subject','directory-user',CURRENT_TIMESTAMP);
INSERT INTO "Team" (id,name,"scimExternalId","updatedAt") VALUES ('legacy-team','Legacy team','directory-group',CURRENT_TIMESTAMP),('manual-team','Operational team',NULL,CURRENT_TIMESTAMP);
INSERT INTO "TeamMember" (id,"userId","teamId",role) VALUES ('owner-membership','owner','legacy-team','OWNER'),('directory-membership','directory-user','legacy-team','MEMBER');
INSERT INTO "Service" (id,name,"teamId","updatedAt") VALUES ('service','Production service','legacy-team',CURRENT_TIMESTAMP);
${migrations}
DO $$ BEGIN
 IF (SELECT count(*) FROM "ScimIdentity" WHERE "userId"='directory-user' AND "externalId"='directory-object') <> 1 THEN RAISE EXCEPTION 'Identity backfill failed'; END IF;
 IF (SELECT count(*) FROM "ScimGroup" WHERE id='legacy-team') <> 1 OR (SELECT count(*) FROM "ScimGroup" WHERE id='manual-team') <> 0 THEN RAISE EXCEPTION 'Group namespace changed'; END IF;
 IF (SELECT count(*) FROM "ScimGroupTeamBinding") <> 0 THEN RAISE EXCEPTION 'Implicit team authority granted'; END IF;
 IF (SELECT count(*) FROM "ScimGroupMembership") <> 1 THEN RAISE EXCEPTION 'Directory member snapshot failed'; END IF;
 IF (SELECT "roleSource" FROM "User" WHERE id='directory-user') <> 'OIDC' THEN RAISE EXCEPTION 'Role authority repair failed'; END IF;
 IF (SELECT count(*) FROM "TeamMember" WHERE "teamId"='legacy-team') <> 2 OR (SELECT role FROM "TeamMember" WHERE id='owner-membership') <> 'OWNER' THEN RAISE EXCEPTION 'Operational memberships damaged'; END IF;
 IF (SELECT "teamId" FROM "Service" WHERE id='service') <> 'legacy-team' THEN RAISE EXCEPTION 'Operational ownership damaged'; END IF;
END $$;
SELECT json_build_object('upgrade','passed','stableGroupIds','preserved','manualTeams','isolated','ownerPrivileges','preserved','serviceOwnership','preserved','implicitBindings',0,'roleAuthority','repaired');
ROLLBACK;`;
  const output = execFileSync(
    docker,
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      decodeURIComponent(url.username),
      '-d',
      'enterprise_scim_test',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
  );
  console.log(output.split('\n').find(line => line.startsWith('{')));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
