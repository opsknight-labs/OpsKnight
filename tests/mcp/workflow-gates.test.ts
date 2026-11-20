import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prWorkflow = readFileSync('.github/workflows/mcp-certification.yml', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/mcp-release-certification.yml', 'utf8');

describe('MCP CI/release gate separation', () => {
  it('runs in main-heavy batches and once per `ci:full` label add, without path filters that leave checks pending', () => {
    expect(prWorkflow).toContain('name: Enterprise MCP PR validation');
    expect(prWorkflow).toMatch(
      /on:\s*pull_request:\s*types: \[opened, synchronize, reopened, labeled\]\s*workflow_dispatch:\s*inputs:\s*base_sha:/
    );
    expect(prWorkflow.split('\njobs:')[0]).not.toContain('paths:');
    // Merges to main are batched by main-heavy.yml instead of running this per push.
    expect(prWorkflow.split('\njobs:')[0]).not.toMatch(/^  push:/m);
    expect(prWorkflow).toContain('inputs.base_sha');
    expect(prWorkflow).toContain('name: Detect MCP-related changes');
    expect(prWorkflow).toContain(
      "if: github.event_name != 'pull_request' || (github.event.action == 'labeled' && github.event.label.name == 'ci:full')"
    );
    // A sticky label re-ran the heavy suites on every agent push, which got the org flagged.
    expect(prWorkflow).not.toContain("labels.*.name, 'ci:full'");
    // A batch diffs against the commit the previous batch tested; an unusable base still validates.
    expect(prWorkflow).toContain(
      'BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before || inputs.base_sha }}'
    );
    expect(prWorkflow).toContain('"$BASE_SHA" = "0000000000000000000000000000000000000000"');
    expect(prWorkflow).toContain('echo "mcp=false" >> "$GITHUB_OUTPUT"');
    expect(prWorkflow).toContain("if: needs.detect-changes.outputs.mcp == 'true'");
    // A missing base commit once made the diff fail and silently skip validation.
    expect(prWorkflow).toContain('git fetch --no-tags --depth=1 origin "$BASE_SHA"');
    expect(prWorkflow).toContain('if ! changed="$(git diff --name-only "$BASE_SHA" HEAD)"; then');
    expect(prWorkflow).not.toMatch(/if git diff --name-only "\$BASE_SHA" HEAD \|/);
    expect(prWorkflow).toContain('env\\.example');
    expect(prWorkflow).toContain('docs/v2\\.2\\.0/(operate|guides|reference)/mcp/');
  });

  it('does not run the human-reviewed GA gate as part of PR validation', () => {
    expect(prWorkflow).not.toContain('release-gates:');
    expect(prWorkflow).not.toContain('MCP_RELEASE_EVIDENCE');
    expect(prWorkflow).toContain('name: MCP PR validation');
  });

  it('runs the pinned official conformance suite against the production build', () => {
    expect(prWorkflow).toContain('npm run --silent mcp:conformance -- --url=http://localhost:3042');
    const harness = readFileSync('scripts/mcp/conformance.ts', 'utf8');
    expect(harness).toMatch(/CONFORMANCE_VERSION = '\d+\.\d+\.\d+'/);
    expect(harness).toContain('@modelcontextprotocol/conformance@${CONFORMANCE_VERSION}');
  });

  it('requires a release asset and protected environment approval for GA certification', () => {
    expect(releaseWorkflow).toContain('name: Enterprise MCP release certification');
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('mcp-release-evidence.json');
    expect(releaseWorkflow).toContain('name: mcp-release-certification');
    expect(releaseWorkflow).toContain('Confirm release tag did not move while awaiting approval');
    expect(releaseWorkflow).toContain('Revalidate evidence after protected approval');
  });
});
