---
trigger: always_on
description: Mandatory Git and Pull Request workflow rules
---

# Git Workflow & Pull Request Rules

1. **Feature Branches Only**: Create a dedicated feature branch for all bug fixes and improvements.
2. **NEVER Direct Merge**: NEVER execute `gh pr merge`, `git merge`, or auto-merge PRs into `main`.
3. **User Review**: Always raise the PR, share the PR link with the user, and wait for the user to review and approve.
