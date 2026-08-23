---
order: 3
title: Icinga 2
description: Configure Icinga 2 notification objects with exact OpsKnight lifecycle, correlation, and security behavior
---

# Icinga 2

Send Icinga 2 host and service notifications to an OpsKnight service. The adapter handles problem, recovery, acknowledgment, downtime, flapping, and custom types using stable host/service correlation.

## Create the OpsKnight integration

1. Open **Services**, select the service, and open **Integrations**.
2. Add **Icinga** and copy the complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/icinga?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

Treat the URL as a credential. Prefer a restricted constants/zone file or a root-owned notification wrapper over duplicating it in broadly readable configuration.

## Define the notification command

This service-notification command generates JSON with Icinga's encoder rather than interpolating check output into raw JSON:

```icinga2
object NotificationCommand "opsknight-service-notification" {
  command = [
    "/usr/bin/curl",
    "--fail-with-body",
    "--silent",
    "--show-error",
    "--request", "POST",
    "--header", "Content-Type: application/json",
    "--data-binary", "$opsknight_payload$",
    "$opsknight_url$"
  ]

  vars.opsknight_url = "https://OPSKNIGHT_HOST/api/integrations/icinga?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY"
  vars.opsknight_payload = {{
    return Json.encode({
      notification_type = macro("$notification.type$")
      host_name = macro("$host.name$")
      host_state = macro("$host.state$")
      service_name = macro("$service.name$")
      service_state = macro("$service.state$")
      service_output = macro("$service.output$")
      check_command = macro("$service.check_command$")
      author = macro("$notification.author$")
      comment = macro("$notification.comment$")
    })
  }}
}
```

Use the corresponding host macros in a separate host `NotificationCommand` and omit service fields. A host and one of its services intentionally use different keys.

## Apply notifications

Example service assignment:

```icinga2
apply Notification "opsknight-service" to Service {
  command = "opsknight-service-notification"
  period = "24x7"
  states = [ OK, Warning, Critical, Unknown ]
  types = [ Problem, Recovery, Acknowledgement, Custom ]
  users = [ "opsknight-notification-user" ]

  assign where service.vars.opsknight == true
}
```

Use your existing user/group and notification-zone conventions. Restrict the assignment with an explicit custom variable or group; do not accidentally forward every test and development service to a production OpsKnight service.

Validate before reloading:

```bash
sudo icinga2 daemon --validate
sudo systemctl reload icinga2
```

## Action and severity contract

| Icinga notification/state                                                   | OpsKnight action              |
| --------------------------------------------------------------------------- | ----------------------------- |
| Type contains `RECOVERY`                                                    | Resolve                       |
| Type contains `ACK`, `ACKNOWLEDGEMENT`, `DOWNTIME`, `FLAPPING`, or `CUSTOM` | Acknowledge an existing match |
| Service state `OK`                                                          | Resolve                       |
| Host state `UP` with no service state                                       | Resolve                       |
| Every other problem state                                                   | Trigger                       |

Critical service or down host maps to critical; warning service maps to warning; unknown service or unreachable host maps to error; recovery maps to info. Service urgency rules still control final incident urgency.

Downtime/flapping messages acknowledge rather than suppress or create. If no matching incident exists, no new incident is opened by the acknowledge event.

## Correlation

- Service key: `icinga-<normalized-host>-<normalized-service>`
- Host key: `icinga-<normalized-host>`

Whitespace becomes hyphens, values are lowercased, and each part is capped at 100 characters. Use stable object names; display-name or object-name changes between problem and recovery can leave the old incident open.

## Request security

OpsKnight validates the integration key. An optional signing secret requires an unprefixed HMAC-SHA256 of the exact raw body in `X-Signature` or `X-Webhook-Signature`.

The command above does not sign. Leave the signing secret unset for that direct configuration, or call a restricted wrapper that signs the encoded body before sending. Require HTTPS and limit who can read or edit the URL.

## Validate end to end

1. Validate and reload the Icinga configuration.
2. Force a disposable service into a hard critical state and confirm the command receives HTTP `202`.
3. Confirm one incident appears with the expected host/service key.
4. Acknowledge in Icinga and confirm the same OpsKnight incident acknowledges.
5. Restore the service and confirm recovery resolves it.
6. Test an actual OpsKnight page through the intended escalation and notification provider.

## Troubleshooting

**Configuration validation fails**

Resolve syntax, zone, object, and variable-scope errors before reload. Compare the command shape with the Icinga version deployed in your environment.

**The incident uses `unknown-host`**

Inspect the rendered payload. Use one of the supported host fields: `host_name`, `hostName`, `host`, or `host_display_name`.

**Recovery does not match**

Confirm trigger/recovery render the same host and service names, and recovery type/state is present. A missing service name changes the key to host-only.

**Curl returns a non-2xx response**

Inspect `--fail-with-body` output: `401` means key/signature failure, `400` means invalid JSON/schema, and `429` means the integration limit was exceeded.

## Related topics

- [Icinga NotificationCommand reference](https://icinga.com/docs/icinga-2/latest/doc/09-object-types/#notificationcommand)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
