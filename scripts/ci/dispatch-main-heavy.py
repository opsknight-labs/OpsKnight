#!/usr/bin/env python3
"""Start the heavy suites once for everything merged to main since the last batch.

Heavy suites do not run on every merge (that compute surge got the org flagged on
2026-11-16). main-heavy.yml calls this every 6 hours. It diffs main against the
commit the last successful batch tested and dispatches each heavy workflow whose
own pull_request `paths` filter matches; workflows without a filter run on any
non-docs change.

Env: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, FORCE ("true" runs everything),
DRY_RUN ("true" prints instead of dispatching), BASE_SHA (overrides the lookup).
"""
import json
import os
import re
import subprocess
import sys

import yaml

HEAVY = [
    'runbook-validation.yml',  # also calls deployment- and swarm-validation; gates itself on base_sha
    'mcp-certification.yml',  # gates itself on base_sha
    'automation-validation.yml',
    'e2e.yml',
    'scim-certification.yml',
    'enterprise-sso-certification.yml',
    'microsoft-teams-e2e.yml',
    'integration-certification.yml',
    'sbom-validation.yml',
]
# These pick their own affected checks from a base commit, so they get one instead of a path filter.
SELF_GATED = {'runbook-validation.yml', 'mcp-certification.yml'}
# Changes that never need a heavy run.
DOCS_ONLY = re.compile(r'^(docs/|plans/|artifacts/|reports/|generated/|public/readme/)|\.md$')


def sh(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout.strip()


def glob_re(pattern):
    """GitHub path-filter glob -> regex (** spans directories, * and ? do not)."""
    out, i = '', 0
    while i < len(pattern):
        if pattern.startswith('**/', i):
            out, i = out + '(?:.*/)?', i + 3
        elif pattern.startswith('**', i):
            out, i = out + '.*', i + 2
        elif pattern[i] == '*':
            out, i = out + '[^/]*', i + 1
        elif pattern[i] == '?':
            out, i = out + '[^/]', i + 1
        else:
            out, i = out + re.escape(pattern[i]), i + 1
    return re.compile(f'^{out}$')


def path_filter(workflow):
    with open(f'.github/workflows/{workflow}') as f:
        doc = yaml.safe_load(f)
    on = doc.get('on', doc.get(True, {}))  # PyYAML reads a bare `on:` key as True
    pr = (on or {}).get('pull_request') or {}
    return [glob_re(p) for p in pr.get('paths', [])] or None


def wants(workflow, changed):
    filters = path_filter(workflow)
    if filters is None:
        return True
    return any(f.match(path) for path in changed for f in filters)


def last_batch_sha(repo):
    try:
        runs = json.loads(sh('gh', 'api', f'repos/{repo}/actions/workflows/main-heavy.yml/runs?branch=main&status=success&per_page=1'))
    except subprocess.CalledProcessError:
        return None  # workflow not on main yet, so there is no previous batch
    return runs['workflow_runs'][0]['head_sha'] if runs.get('workflow_runs') else None


def main():
    repo, head = os.environ['GITHUB_REPOSITORY'], os.environ.get('GITHUB_SHA') or sh('git', 'rev-parse', 'HEAD')
    force = os.environ.get('FORCE') == 'true'
    dry = os.environ.get('DRY_RUN') == 'true'
    base = os.environ.get('BASE_SHA') or last_batch_sha(repo)

    if force or not base or subprocess.run(['git', 'cat-file', '-e', f'{base}^{{commit}}']).returncode:
        changed, reason = None, 'forced' if force else f'no usable previous batch ({base})'
    else:
        changed = [p for p in sh('git', 'diff', '--name-only', base, head).splitlines() if p]
        reason = f'{len(changed)} files changed since {base[:12]}'
    print(f'Batch for {head[:12]}: {reason}')

    if changed is not None:
        changed = [p for p in changed if not DOCS_ONLY.search(p)]
        if not changed:
            print('No code changes since the last batch (docs only or none); nothing to run.')
            return

    picked = [w for w in HEAVY if changed is None or wants(w, changed)]
    for workflow in HEAVY:
        print(f"  {'run ' if workflow in picked else 'skip'} {workflow}")
    for workflow in picked:
        extra = ['-f', f'base_sha={base}'] if workflow in SELF_GATED and changed is not None else []
        if not dry:
            sh('gh', 'workflow', 'run', workflow, '--repo', repo, '--ref', 'main', *extra)
    with open(os.environ.get('GITHUB_STEP_SUMMARY', os.devnull), 'a') as summary:
        summary.write(f'### Heavy batch for `{head[:12]}`\n\n{reason}\n\nStarted: {", ".join(picked) or "none"}\n')


if __name__ == '__main__':
    # Self-check of the glob translation before touching anything.
    assert glob_re('src/lib/chatops/**').match('src/lib/chatops/a/b.ts')
    assert glob_re('tests/**/*microsoft-teams*').match('tests/e2e/microsoft-teams.spec.ts')
    assert glob_re('tests/**/*microsoft-teams*').match('tests/microsoft-teams.test.ts')
    assert not glob_re('src/*.ts').match('src/lib/a.ts')
    assert glob_re('prisma/migrations/**teams**/**').match('prisma/migrations/2026_teams_x/migration.sql')
    sys.exit(main())
