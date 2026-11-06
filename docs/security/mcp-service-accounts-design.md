# MCP service accounts: design for sign-off

Status: **proposal, not built.** Nothing in this page is implemented. It exists so the owners can decide the identity model before any code is written, because getting it wrong is a security problem, not a refactor.

## The problem

Every MCP credential today belongs to a person. A person signs in and consents (OAuth), or creates a personal access token (PAT) after a fresh sign-in. That fits an on-call engineer using Claude or Cursor. It fits badly when the caller is a **system**: a CI job, a nightly reporting agent, an automation platform, a bot in a chat tool.

Today those use a PAT created by whoever set them up. The consequences:

- The credential acts **as that person**, so it stops working when they leave, and its actions in the audit trail look like theirs.
- Its power is the person's role, narrowed by the PAT scope list. Nobody reviews the agent as its own thing.
- A PAT can never approve its own changes, but it also cannot be owned by a team.
- There is no way to say "this agent may read incidents and nothing else, whoever created it".

REST already has a non-human concept (`/api/v2/service-accounts`, with an `isServiceAccount` flag on its key principal). The MCP principal sets that flag to `false` everywhere (`src/lib/mcp/auth/principal.ts`). Personal tokens cover the gap for now.

## What a good answer must give

1. **A principal that is not a person**, owned by a team or an administrator, with its own name in every audit row and request-log row.
2. **Least privilege by construction**: a fixed, administrator-chosen scope set, never the broader of "creator's role" and something else.
3. **No standing human credential**: no password, no browser sign-in, no consent page.
4. **Safe lifecycle**: expiry, rotation without downtime, and a defined outcome when its owner leaves.
5. **The same guardrails as people**: revocation that works immediately, rate limits, the kill switch, the read-only cap, the sensitive-reads opt-in.
6. **Never approves anything**, and never approves its own requests.

## Options

| Option                                                 | What it is                                                                                                                                                          | For                                                                                              | Against                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| A. Service-account principal with `client_credentials` | A named non-human identity; the client authenticates with a client secret or, better, a signed assertion (`private_key_jwt`) and receives short-lived access tokens | Standard OAuth for machines; no long-lived bearer secret if assertions are used; rotates cleanly | Largest change: a new principal type through authority resolution, consent, audit and every place that reads `userId` |
| B. Owned PATs                                          | Keep PATs, add an "owner is a team/service account" field and stop tying them to a person's role                                                                    | Small; reuses the PAT path and its tests                                                         | Still a long-lived bearer secret; still needs a role to evaluate authority against                                    |
| C. Do nothing                                          | PATs only                                                                                                                                                           | No new risk                                                                                      | The gap stays; people keep creating PATs under their own names                                                        |

**Recommendation: A, delivered in two steps.** Step 1 adds the principal and secret-based `client_credentials` with strict scopes and short-lived tokens. Step 2 adds signed assertions and makes secrets optional. B is not recommended: it keeps the weakest property (a long-lived secret) and still has to invent an authority source.

## Proposed model (option A)

**Identity.** A `McpServiceAccount` has a name, a description, an owner (a team or an administrator), a status, an allowed scope list and an expiry. It is not a `User`: it has no role, no teams, no session and no email.

**Authority.** The effective scopes are the intersection of the account's allowed scopes, the administrator policy ceiling, and `requireReadOnlyConnections`. There is no role to inherit, which is the point. Resource visibility needs a rule (see question 1).

**Credentials.** Each account holds up to two active credentials so a secret can be rotated without downtime. Secrets are shown once and stored as keyed digests, like personal tokens. Access tokens are short-lived (5 minutes, as for people) and are not refreshed: the client authenticates again.

**What it cannot do.**

- Approve any change, ever. Approval routes require a signed-in human administrator or approver.
- Run `runbooks:execute` (same exclusion as PATs).
- Change policy, create other credentials, or read the audit log unless an administrator explicitly allows `audit:read` and sensitive reads are on.

**Audit and logs.** Every request-log and audit row carries the service account id in the actor position; the Usage tab shows it as its own line. Creation, rotation, scope changes, expiry and revocation are audited with the human who did them.

**Lifecycle.**

- Expiry is required (maximum set by policy, default 90 days).
- A notice goes to the owner 14 and 3 days before expiry.
- If the owning person is deactivated, the account is **suspended, not deleted**, and its owner reverts to the creating administrator until someone takes it over. It never keeps working unowned.
- Disabling the feature in policy revokes every service account credential at once, like PATs.

**Policy additions.** `serviceAccountsEnabled` (off by default), maximum lifetime, an allowed-scope ceiling separate from the PAT list, and an optional per-account rate limit. Turning the feature on or raising limits is "widening" and needs a recent sign-in.

## Threats specific to this model

| Threat                                                                | Mitigation                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Leaked client secret                                                  | Short-lived tokens; two-credential rotation; secret-scanner prefix; optional signed assertions remove the secret entirely |
| Over-privileged account                                               | Fixed scope list reviewed at creation; read-only cap applies; no role inheritance                                         |
| Orphaned account                                                      | Mandatory owner and expiry; suspension on owner departure                                                                 |
| Confused deputy (an agent acting for a user it was not authorized by) | The account acts as itself and is labelled as such everywhere; it never impersonates a user                               |
| Self-approval                                                         | Structurally impossible: approval needs a human session                                                                   |

## Questions the owners must answer first

1. **What may a service account _see_?** People are limited to their teams. Options: all resources its scopes allow (simple, broad), or only resources owned by its owning team (safer, needs a rule for global data such as the schedule list). This is the most important decision.
2. **Who may create one?** Administrators only, or team leads for their own team?
3. **Secrets or signed assertions first?** Assertions are stronger but harder for small teams to adopt.
4. **Should an account be allowed to make changes at all?** A read-only default with an explicit write opt-in would match how people start out.
5. **Is a per-account request limit enough, or is a monthly quota needed?**
6. **Customer expectations:** do any current customers ask for `client_credentials` specifically, or is "a non-human token" enough?

## Test plan once approved

- Authority: scopes are exactly the intersection; no role leaks; a removed team changes visibility on the next call (if question 1 chooses team-owned).
- Lifecycle: expiry, two-secret rotation with no failed call, suspension on owner deactivation, revoke-all on policy off.
- Safety: approval attempts by an account are refused on every approval path; `runbooks:execute` is never grantable.
- Audit: every lifecycle event and every call attributes to the account and the human actor.
- Abuse: rate limits, the kill switch and read-only cap apply identically to people.

## Not decided here

Migration of existing PATs (none are converted automatically), a UI design, and the wire format of signed assertions. Those follow the answers above.
