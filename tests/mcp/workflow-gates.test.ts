import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prWorkflow = readFileSync('.github/workflows/mcp-certification.yml', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/mcp-release-certification.yml', 'utf8');

describe('MCP CI/release gate separation', () => {
  it('runs on main and on every pull request, deciding by changed paths inside a job rather than a label or a paths filter', () => {
    expect(prWorkflow).toContain('name: Enterprise MCP PR validation');
    expect(prWorkflow).toMatch(
      /on:\s*pull_request:\s*types: \[opened, synchronize, reopened\]\s*push:\s*branches: \[main\]\s*workflow_dispatch:/
    );
    expect(prWorkflow.split('\njobs:')[0]).not.toContain('paths:');
    expect(prWorkflow).toContain('name: Detect MCP-related changes');
    // No label gate: the detect job runs on every pull request and the heavy jobs follow its
    // output (a job-level skip reports success, which a workflow-level paths filter does not).
    expect(prWorkflow).not.toContain('ci:full');
    // Adding a label must not restart the validation (and cancel the run in progress).
    expect(prWorkflow).not.toContain('labeled');
    const detect = prWorkflow.slice(
      prWorkflow.indexOf('  detect-changes:'),
      prWorkflow.indexOf('  contract-security:')
    );
    expect(detect).not.toMatch(/\n    if:/);
    // A push to main diffs against the previous main commit; an unusable base still validates.
    expect(prWorkflow).toContain(
      'BASE_SHA: ${{ github.event.pull_request.base.sha || github.event.before }}'
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

  it('requires a release asset and protected environment approval for GA certification', () => {
    expect(releaseWorkflow).toContain('name: Enterprise MCP release certification');
    expect(releaseWorkflow).toContain('workflow_dispatch:');
    expect(releaseWorkflow).toContain('mcp-release-evidence.json');
    expect(releaseWorkflow).toContain('name: mcp-release-certification');
    expect(releaseWorkflow).toContain('Confirm release tag did not move while awaiting approval');
    expect(releaseWorkflow).toContain('Revalidate evidence after protected approval');
  });
});
