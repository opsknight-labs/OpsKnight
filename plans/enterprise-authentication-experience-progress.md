# Enterprise Authentication Experience

Base: merged PR #865, main 4be1e13. Worktree: opsknight-authentication-experience.
Branch: feat/enterprise-authentication-experience. One complete PR after implementation.

## Acceptance tracking

- [x] Phase 0: provider leakage, cross-section staging, inline validation, prerequisites, revision/reset races.
- [x] Phase 1: feature modules, unified draft lifecycle, deep links, operational overview and guided setup.
- [x] Phase 2: provider registry, Entra tenant setup, callback copy, session presets/effective defaults, role editor.
- [x] Phase 3: database-filtered sessions, signed keyset pagination, delivery details, audit and replica navigation.
- [x] Phase 4: compact recovery directory, account details, scoped action confirmations and secure one-time display.
- [x] Phase 5: component/API/PostgreSQL regressions, large-data EXPLAIN, production browsers, accessibility and responsive review.

Security boundary: preserve stage/test/activate, linking, Required enforcement, recovery session restrictions, secrets and released-version upgrades. Live tenants and physical-key certification remain external acceptance, as previously agreed.

## Verification evidence

- Broad auth/OIDC/SCIM/notification regression selection: 486 passing tests.
- Latest focused component/API/cursor/redaction/clipboard selection: 51 passing tests.
- PostgreSQL integration: 128 passing tests, including 100,000 sessions and delivery/replica pages.
- Non-UTC PostgreSQL pagination certification: 16 passing cases; query-local UTC prevents repeated boundaries.
- Published v2.0.0 upgrade plus bounded authentication load: 12 passing tests.
- Fresh production HTTPS browser run: 7 passed, 2 expected virtual-key skips; Chromium, Firefox, WebKit.
- Axe WCAG 2 A/AA and 2.1 AA checks and responsive overflow assertions at 320/390/768/1366/1920 px passed.
- Source and measurement receipts: `plans/certification/authentication-experience-diagnostics.json`, `enterprise-sso-2.1-password-browser.json`, `enterprise-sso-2.1-authentication-load.json`.

Static verification: strict TypeScript, modified-file ESLint with zero warnings, Prisma schema validation, additive migration validation and documentation contracts passed. Browser receipt source hashes match the checked workspace. Branch publication is tracked separately from external acceptance.


## PR #867 follow-up review

- Activation returns the committed provider configuration version and advances only
  the draft version fence. Draft contents and baseline remain intact. Regression:
  stage, activate, edit immediately and stage again against the returned version.
- Replica observations persist allowlisted mismatch names, and diagnostics displays
  names without observed identity/secret values. Older observations compare only
  against the immutable import. PostgreSQL asserts actual mismatch names.
- Explicit draft replacement/discard resets duration-control presentation. Tests cover
  custom-to-inherited, custom-to-preset and loading a saved configuration.
- Existing non-public Entra authorities automatically expose their exact issuer.
  Public, US Government, China and custom authority presentation are covered locally;
  backend authority validation remains authoritative.
- The unreleased diagnostic migration now only adds the nullable projection. Docker,
  Helm, safe migration and certification paths invoke concurrent indexes plus bounded
  historical projection. Preview checksum handling is documented; shared databases
  must never be reset. Online deployment certification runs alongside real registry
  authorization and durable security-event writes.
- Session diagnostics explicitly describes live pagination and disappearing mutable
  rows; it does not claim immutable ordinary sign-in history.
- Fixed the broad CI database failure: the dedicated 100k diagnostics suite runs only
  in its isolated enterprise certification database, rather than failing another
  database job's fixture guard.

Follow-up validation: 50 focused component/API/cursor tests, 129 PostgreSQL tests,
12 published-release upgrade/load tests, four documentation contracts, strict TypeScript,
modified-file ESLint (zero warnings), Prisma validation and migration validation passed.
The migration validator retains its 40 pre-existing warnings. Fresh production HTTPS certification passed seven browser tests with two expected
virtual-key skips and zero flakes. Entra authorities, Google switching, all diagnostic
views, emergency recovery, keyboard flows and responsive axe checks passed across
Chromium, Firefox and WebKit; receipt source hashes match the workspace. The initial
walkthrough run exposed test selector/disabled-action assumptions, corrected before
this clean run. New remote CI must finish on the follow-up commit; live tenants and
physical keys remain pending as previously scoped.
