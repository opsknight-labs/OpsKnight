# Jira release-hardening verification checklist

The following gates must pass before this hardening change is considered ready to merge:

- [ ] TypeScript and lint
- [ ] Unit/component/architecture tests
- [ ] Prisma migration validation
- [ ] Security suite / code scanning
- [ ] Production Docker build
- [ ] Stored-token origin-change regression
- [ ] Same-key cross-owner concurrency regression
- [ ] Out-of-order webhook regression
- [ ] Duplicate inbound delivery regression
- [ ] Jira deletion regression
- [ ] Retry-After and shared breaker regression
- [ ] Final create-attempt terminal-state regression

The pull request should only be marked ready for review after automated CI is green on the exact final head.
