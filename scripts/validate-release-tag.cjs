const fs = require('node:fs');
const path = require('node:path');

function parseStableVersion(tag, label) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
  if (!match) {
    throw new Error(`${label} must be a stable semantic version (vMAJOR.MINOR.PATCH)`);
  }
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validateReleaseTag({ tag, packageVersion, latestReleaseTag = '' }) {
  const releaseVersion = parseStableVersion(tag, 'Release tag');
  const expectedVersion = parseStableVersion(packageVersion, 'package.json version');

  if (compareVersions(releaseVersion, expectedVersion) !== 0 || tag !== `v${packageVersion}`) {
    throw new Error(`Release tag ${tag} must exactly match package.json version v${packageVersion}`);
  }

  if (latestReleaseTag) {
    const latestVersion = parseStableVersion(latestReleaseTag, 'Latest GitHub release tag');
    if (compareVersions(releaseVersion, latestVersion) <= 0) {
      throw new Error(`Release ${tag} must be newer than published ${latestReleaseTag}`);
    }
  }
}

if (require.main === module) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  try {
    validateReleaseTag({
      tag: process.argv[2] || process.env.GITHUB_REF_NAME,
      packageVersion: packageJson.version,
      latestReleaseTag: process.env.LATEST_RELEASE_TAG || '',
    });
    console.log(`Validated stable release tag v${packageJson.version}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { compareVersions, parseStableVersion, validateReleaseTag };
