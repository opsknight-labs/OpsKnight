// Limited local filesystem probe. This does not start OpsKnight or exercise CSI/SCCs.
// Uses synthetic fixtures, no cloud credentials, no network, and no host mounts.
import { execFileSync } from 'node:child_process';

const image = process.argv[2] ?? 'ghcr.io/opsknight-labs/opsknight:2.1.2';
const inspected = JSON.parse(
  execFileSync('docker', ['image', 'inspect', image, '--format', '{{json .}}'], {
    encoding: 'utf8',
  })
);
const cases = [
  {
    name: 'fixed-uid-with-matching-file-group',
    uid: 1001,
    gid: 1001,
    groups: [1001],
    fileGroup: 1001,
    expectedReadable: true,
  },
  {
    name: 'arbitrary-uid-with-primary-group-zero',
    uid: 1000680000,
    gid: 0,
    groups: [],
    fileGroup: 0,
    expectedReadable: true,
  },
  {
    name: 'arbitrary-uid-without-matching-file-group',
    uid: 1000680000,
    gid: 1000680000,
    groups: [],
    fileGroup: 0,
    expectedReadable: false,
  },
  {
    name: 'arbitrary-uid-with-matching-supplemental-group',
    uid: 1000680000,
    gid: 1000680000,
    groups: [1000680001],
    fileGroup: 1000680001,
    expectedReadable: true,
  },
];
const results = cases.map(scenario => {
  const probe = `
    const fs = require('node:fs');
    const scenario = ${JSON.stringify(scenario)};
    const keys = ['DATABASE_URL', 'DIRECT_DATABASE_URL', 'WEB_DATABASE_URL', 'NEXTAUTH_SECRET', 'API_KEY_SECRET', 'ENCRYPTION_KEYS', 'SETUP_SECRET'];
    for (const key of keys) {
      fs.writeFileSync('/probe/' + key, 'synthetic-permission-fixture');
      fs.chownSync('/probe/' + key, 0, scenario.fileGroup);
      fs.chmodSync('/probe/' + key, 0o440);
    }
    process.setgroups(scenario.groups);
    process.setgid(scenario.gid);
    process.setuid(scenario.uid);
    function accessible(file, mode) {
      try { fs.accessSync(file, mode); return true; } catch { return false; }
    }
    const allFilesReadable = keys.every(key => accessible('/probe/' + key, fs.constants.R_OK));
    const result = {
      ...scenario,
      effectiveUid: process.getuid(), effectiveGid: process.getgid(),
      supplementalGroups: process.getgroups(),
      fileMode: (fs.statSync('/probe/DATABASE_URL').mode & 0o777).toString(8),
      allFilesReadable,
      applicationEntryReadable: accessible('/app/server.js', fs.constants.R_OK),
      readOnlyRootFilesystem: true,
      expectedOutcomeObserved: allFilesReadable === scenario.expectedReadable
    };
    console.log(JSON.stringify(result));
    if (!result.expectedOutcomeObserved || !result.applicationEntryReadable) process.exitCode = 1;
  `;
  return JSON.parse(
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--pull=never',
        '--network=none',
        '--read-only',
        '--memory=128m',
        '--pids-limit=64',
        '--security-opt=no-new-privileges',
        '--cap-drop=ALL',
        '--cap-add=CHOWN',
        '--cap-add=SETUID',
        '--cap-add=SETGID',
        '--user=0:0',
        '--tmpfs=/probe:rw,noexec,nosuid,size=65536,mode=0755',
        '--entrypoint=node',
        inspected.Id,
        '-e',
        probe,
      ],
      { encoding: 'utf8', timeout: 30_000 }
    )
  );
});
console.log(
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope:
        'Local release-image filesystem access with synthetic 0440 files; no application startup, CSI retrieval, cloud identity, or OpenShift SCC admission.',
      image: {
        reference: image,
        id: inspected.Id,
        repoDigests: inspected.RepoDigests,
        architecture: inspected.Architecture,
        sourceRevision: inspected.Config.Labels?.['org.opencontainers.image.revision'],
        defaultUser: inspected.Config.User,
      },
      results,
    },
    null,
    2
  )
);
