---
title: Import and set up business services
description: Create one business service with the guided setup, or many at once from CSV, YAML or a Backstage catalog, with a preview of every change before it is applied.
type: how-to
product_area: services
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/lib/business-services/setup.ts
    - src/lib/business-services/import.ts
    - src/lib/business-services/catalog-sync.ts
    - src/lib/intelligence/dependencies/topology-sources.ts
    - src/components/settings/TopologyManager.tsx
    - src/components/business-service-setup/SetupWizard.tsx
    - src/components/business-service-import/ImportDialog.tsx
    - src/app/api/v2/business-services/import/route.ts
    - src/app/api/v2/business-services/[id]/supporting/route.ts
---

# Import and set up business services

You need Responder or Admin access. Adding a business service to a status page also needs status
page management.

## Set up one business service

Open **Services → Business services → Setup** (`/services/business/setup`). Five steps:

1. **Name** and a short description in your customers' words.
2. **Services**: tick the technical services behind it. **Suggest related services** lists the
   services they depend on, from your active service dependencies; add the ones whose outage
   would take this business service down too.
3. **Ownership**: owner team, criticality (Tier 0 is business critical) and, optionally, the
   lowest incident urgency and the highest priority that count as impact. Leave them on the tier
   default unless you have a reason.
4. **Status pages** to show it on.
5. **Subscribers**: teams to keep informed, or **Subscribe all users**. See
   [Keep stakeholders informed](../stakeholders).

The business service is created in one step. If a status page or the subscribers cannot be
saved, you see a warning and can add them afterwards.

## Import many

Choose **Import** on the setup page, pick a format, upload or
paste the file, then **Preview changes**. The preview shows, for each row, whether it is new,
changed or unchanged, which fields change, and which services are added or removed. Problems are
listed first; while there are any, nothing can be applied. **Apply import** writes every row in
one go, or nothing if something fails, and records one audit entry.

Rules for every format:

- At most 1000 business services and 2 MB per import.
- Rows match existing business services by name, ignoring case.
- A field you leave out stays as it is. A member list you give replaces the current members.
- Services and teams are matched by id or name; a name shared by two is reported, use the id.
- `criticality` accepts `TIER_0` to `TIER_3`, `tier-1`, `Tier 2` or just `0` to `3`.
- `dependsOn` names other business services (in the file or already in OpsKnight) this one depends
  on. Loops are rejected.

### CSV

A header row with `name` and any of `description`, `criticality`, `owner_team`, `members`,
`depends_on`. Separate list items with `;`. A blank cell leaves that field unchanged.

```csv
name,description,criticality,owner_team,members,depends_on
Checkout,Paying for an order,TIER_0,Payments,checkout-api;payments-api,Payments
Payments,,TIER_0,Payments,payments-api;ledger,
```

### YAML

A list, or a `businessServices` list. `members: []` clears the members.

```yaml
businessServices:
  - name: Checkout
    criticality: TIER_0
    ownerTeam: Payments
    members: [checkout-api, payments-api]
    dependsOn: [Payments]
```

### Backstage catalog

Paste `catalog-info.yaml` documents. Each `System` becomes a business service. Each `Component`
whose `spec.system` names that system becomes a member, matched by its
`opsknight.com/service-id` annotation, otherwise by name. A system's `dependsOn` on other systems
becomes its supporting business services.

### Keep them in sync with Backstage

A Backstage topology source can also keep business services up to date on its schedule. Open
**Settings → Intelligence → Services & changes → Import topology from Backstage**, then tick
**Sync Systems as business services** when you add a source, or on an existing source and
**Save**. Tick **Include Domains** to also turn each Domain into a business service supported by
its Systems. You need permission to manage intelligence settings.

Each sync maps Systems the same way as the paste import above, with the same checks, and applies
all of them or none:

- Each synced business service is tied to its source by an external key, so a later sync updates
  it instead of creating a new one.
- A business service you created by hand with the same name is taken over by the sync, not
  duplicated. A name another source already syncs is left alone and reported.
- When a System leaves the catalog, its business service is marked as removed, not deleted. It
  is restored if the System comes back. Business services created by hand are never deleted.
- When no Component of a System matches a service, its current members are kept.
- References that match nothing are dropped and reported instead of failing the sync.

The source's last result lists how many business services were created, updated, marked removed,
owned by another source or left with unmatched references. Every sync, removal and restore is in
the audit log. A failed business-service sync never undoes the dependencies the source imported.

## API

- `POST /api/v2/business-services/import?dryRun=true` with `{ "format": "csv", "content": "..." }`
  returns the preview; without `dryRun` it applies. Send an `Idempotency-Key`. Very large files can
  exceed the API's transaction time; split them if that happens.
- `PUT /api/v2/business-services/{id}/supporting` with `{ "businessServiceIds": [...] }` sets the
  business services this one depends on, rejecting loops.

Assistants using MCP can call both, but a person approves each write first.
