---
title: Use Slack incident commands
description: Run supported signed slash commands and verify their authoritative OpsKnight incident effects.
type: how-to
product_area: chatops
audience: [responder]
keywords: [Slack slash commands, incident command]
reader:
  status: READER_COMPLETE
  task: Use and verify supported Slack incident commands.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/chatops/slash-commands.ts, src/lib/slack/app-manifest.ts]
---

# Use Slack incident commands

## Before you begin

Install the current Slack app manifest, link your identity, and open an incident destination/war room where the command context is clear.

## Open the feature

In Slack's message composer, enter `/incident help` to display the supported command syntax.

## Configure the command

Supported commands are `ack`, `resolve [summary]`, `note <message>`, `who`, `postmortem`, and `help`. Provide required text and avoid sensitive information in notes/summaries.

## Complete the action

1. Enter `/incident <command>` with its argument.
2. Submit once and read the response.
3. Complete identity linking if prompted.
4. Open OpsKnight when the response says the action was queued or cannot confirm final state.

## What OpsKnight does

OpsKnight validates the Slack signature/timestamp, parses only the supported grammar, maps identity, checks authorization/context, and applies the same product transition used by the UI.

## Verify it worked

Confirm the authoritative incident timeline/state/actor in OpsKnight and the updated Slack projection. For `who`, confirm the reported ownership matches current OpsKnight state.

## Change or undo the command

Commands create product actions; deleting Slack command text does not undo them. Use the supported incident workflow to correct state or add a clarifying note.

## Troubleshooting

**Command not recognized:** use `/incident help` and confirm the current app package registered the command.

**Wrong incident/context:** open the intended incident message/war room and retry only after confirming no action applied.

**Temporary queue error:** inspect OpsKnight worker health and operation state before retrying.

## Next steps

- [Acknowledge and resolve](./acknowledge-resolve)
- [Troubleshoot Slack](./troubleshooting)

