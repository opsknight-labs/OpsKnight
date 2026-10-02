const fs = require('node:fs');
const path = require('node:path');

function parseStableVersion(tag, label) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
  if (!match) {
    throw new Error(`${label} must be a stable semantic version (vMAJOR.MINOR.PATCH)`);
  }
  return match.slice(1).map(Number);
}

function parseReleaseVersion(tag, label) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag || '');
  if (!match) {
    throw new Error(`${label} must be a semantic version tag (vMAJOR.MINOR.PATCH[-PRERELEASE])`);
  }
  return {
    version: match.slice(1, 4).map(Number),
    prerelease: match[4] || '',
  };
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function validateReleaseTag({ tag, packageVersion, latestReleaseTag = '' }) {
  const release = parseReleaseVersion(tag, 'Release tag');
  const expected = parseReleaseVersion(packageVersion, 'package.json version');

  if (compareVersions(release.version, expected.version) !== 0) {
    throw new Error(`Release tag ${tag} must target package.json version v${packageVersion}`);
  }

  if (release.prerelease) {
    if (expected.prerelease && release.prerelease !== expected.prerelease) {
      throw new Error(`Prerelease tag ${tag} must exactly match package.json version v${packageVersion}`);
    }
    return;
  }

  if (expected.prerelease || tag !== `v${packageVersion}`) {
    throw new Error(`Stable release tag ${tag} must exactly match package.json version v${packageVersion}`);
  }

  if (latestReleaseTag) {
    const latestVersion = parseStableVersion(latestReleaseTag, 'Latest GitHub release tag');
    if (compareVersions(release.version, latestVersion) <= 0) {
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
    console.log(`Validated release tag ${process.argv[2] || process.env.GITHUB_REF_NAME}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { compareVersions, parseReleaseVersion, parseStableVersion, validateReleaseTag };
