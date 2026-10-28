import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prWorkflow = readFileSync('.github/workflows/mcp-certification.yml', 'utf8');
const releaseWorkflow = readFileSync('.github/workflows/mcp-release-certification.yml', 'utf8');

describe('MCP CI/release gate separation', () => {
  it('runs the PR workflow on every pull request so required checks are never path-filter pending', () => {
    expect(prWorkflow).toContain('name: Enterprise MCP PR validation');
    expect(prWorkflow).toMatch(/on:\s*pull_request:\s*workflow_dispatch:/);
    expect(prWorkflow).not.toMatch(/pull_request:\s*paths:/);
    expect(prWorkflow).toContain('name: Detect MCP-related changes');
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
