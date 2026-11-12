---
title: Govern AI spend with prices and budgets
description: See AI spend in dollars by team, capability and model, set model prices, and cap daily spend per team or capability.
type: how-to
product_area: intelligence
audience: [administrator, operator]
reader:
  status: SOURCE_VERIFIED
  task: Track AI spend and stop one team or feature from using up the shared AI allowance.
verification:
  level: test
  verified_at: 2026-11-08
  evidence:
    [
      src/lib/intelligence/ai/pricing.ts,
      src/lib/intelligence/ai/cost.ts,
      src/lib/intelligence/ai/scoped-budget.ts,
      src/lib/intelligence/ai/budget.ts,
      monitoring/prometheus/opsknight-alerts.yaml,
      monitoring/prometheus/intelligence.test.yml,
      tests/unit/intelligence-ai-pricing.test.ts,
      tests/integration/intelligence/ai-cost-budgets.test.ts,
      tests/components/ai-spend-panel.test.tsx,
    ]
---

# Govern AI spend with prices and budgets

OpsKnight counts the tokens every AI request uses and, when the model has a price, its cost in US dollars.
The **Spend and budgets** and **Model prices** sections are under **Settings → Intelligence → Assistant & AI**.
Anyone with Intelligence read access can see spend; changing prices or budgets needs Intelligence manage.

Nothing here changes behaviour until you add a budget. Without one, only the existing global and per-person
daily token budgets apply.

## See where spend goes

**Spend and budgets** shows the last 7 or 30 UTC days (today included):

- total dollars, tokens and requests, and a daily bar chart (open **Show daily spend as a table** for exact numbers);
- spend **by team**, **by capability** (assistant chat, summaries, diagnosis, postmortem drafts, classification,
  embeddings, provider tests) and **by model**, largest first, with the twelfth and later grouped as **Other**;
- today's usage against every enabled budget, coloured amber from 80% and red at 100%.

Each call is charged to exactly one team, so team totals add up to the overall total:

1. the owning team of the incident the request is about, if any;
2. otherwise the person's earliest team membership;
3. otherwise **No team** (background embedding and provider tests are always **No team**).

Usage recorded before this feature existed has tokens but no dollars, and is not broken down by team.

## Set model prices

Dollars come from a price per million input tokens and per million output tokens.

- **Built-in list prices** cover common models from OpenAI and Azure OpenAI, Anthropic (also on Bedrock and
  Vertex), Google Gemini, Mistral and Groq. They are public list prices at the time of the release and do not
  know about discounts, cached-token rates, batch pricing or price changes.
- **Your prices** override the built-in price for one provider kind and exact model id. Use them for negotiated
  or regional rates, and for self-hosted or other **OpenAI-compatible** endpoints, which have no built-in price.
  Removing your price restores the list price.

The table at the top of **Model prices** shows which price each configured chat and embedding model uses. A
model with no price is **unpriced**: its tokens count toward token budgets, its dollars are shown as `$0.00`
with an asterisk, and the page tells you how many requests were unpriced. Price changes apply to new requests
within 30 seconds; past spend is not recalculated.

## Add a budget

Open **Add a budget**, choose a team or a capability, and set a daily token limit, a daily dollar limit or both.
Leave a field empty for no limit in that unit. Untick **Enforced** to keep a budget visible without enforcing it.

A budget is checked in the same database transaction as the global and per-person budgets, before every model
call and every fallback attempt, and counts both settled usage and requests still in flight. When a request
would take a team or capability over its limit:

- the request is refused before any provider is called;
- it ends exactly as when the global daily budget is reached: the assistant answers in basic mode, and other AI
  features report that the daily AI budget was reached;
- the limit resets at 00:00 UTC.

If the budget tables cannot be read, AI requests are refused (fail closed), the same as the global budget.
Dollar limits apply only to priced calls: an unpriced call adds no dollars, so pair a dollar limit with a token
limit when unpriced models are in use. Reservations are estimates; the settled cost can be slightly higher than
the estimate, so a budget can end the day a little over its limit, never far over it.

Edits use a revision check: if someone else changed the budget since you opened the page, saving fails and asks
you to refresh. Every price and budget change is recorded in the audit log with old and new values.

## Alerts

The metrics endpoint exports bounded series (no team or budget identifiers):

| Metric                                                              | Meaning                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `opsknight_intelligence_ai_spend_today_usd`                         | Settled, priced spend for the current UTC day                                      |
| `opsknight_intelligence_ai_budget_utilization_max_ratio{scope}`     | Highest utilisation in `global`, `team` or `capability`                            |
| `opsknight_intelligence_ai_budgets_over_threshold{scope,threshold}` | Budgets at or above `0.8` or `1`                                                   |
| `opsknight_intelligence_ai_budget_rejections_total{scope}`          | Requests refused by `global`, `user`, `background`, `team` or `capability` budgets |

`monitoring/prometheus/opsknight-alerts.yaml` ships two warnings, tested with promtool in
`monitoring/prometheus/intelligence.test.yml`:

- **OpsKnightAiBudgetNearLimit**: a budget in a scope has been at 80% or more for 10 minutes.
- **OpsKnightAiBudgetExhausted**: a budget in a scope has been at 100% for 5 minutes.

The alert names the scope; open **Spend and budgets** to see which team or capability it is. Paging and the
deterministic Intelligence engine never depend on AI budgets.

## Roll back

Remove or untick the budgets. Prices and spend records are inert without budgets and need no clean-up; the
database changes are additive and safe to leave in place on a downgrade.
