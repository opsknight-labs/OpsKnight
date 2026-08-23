---
order: 2
title: Nagios Core and XI
description: Configure safe Nagios host and service notification commands with exact OpsKnight action and correlation rules
---

# Nagios Core and XI

Send Nagios host and service notifications to an OpsKnight service. Problem, recovery, acknowledgment, downtime, flapping, and custom notification types have distinct v1.3 behavior.

## Create the OpsKnight integration

1. Open **Services**, select the service, and open **Integrations**.
2. Add **Nagios** and copy its complete URL:

```text
https://OPSKNIGHT_HOST/api/integrations/nagios?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The URL contains a credential. Store it in a root-readable Nagios resource/custom variable rather than a world-readable command file where possible.

## Configure notification commands

OpsKnight requires JSON. Field names must be the supported lowercase names without underscores or the uppercase Nagios macro names. For example, use `NOTIFICATIONTYPE`, not `notification_type`; use `SERVICEDESC`, not `service_description`.

This example uses `jq` so check output is JSON-escaped instead of interpolated directly into a JSON string:

```ini
define command {
    command_name notify-host-by-opsknight
    command_line /usr/bin/jq -cn --arg NOTIFICATIONTYPE "$NOTIFICATIONTYPE$" --arg HOSTNAME "$HOSTNAME$" --arg HOSTADDRESS "$HOSTADDRESS$" --arg HOSTSTATE "$HOSTSTATE$" --arg HOSTOUTPUT "$HOSTOUTPUT$" --arg LONGHOSTOUTPUT "$LONGHOSTOUTPUT$" --arg AUTHOR "$NOTIFICATIONAUTHOR$" --arg COMMENT "$NOTIFICATIONCOMMENT$" '{NOTIFICATIONTYPE:$NOTIFICATIONTYPE,HOSTNAME:$HOSTNAME,HOSTADDRESS:$HOSTADDRESS,HOSTSTATE:$HOSTSTATE,HOSTOUTPUT:$HOSTOUTPUT,LONGHOSTOUTPUT:$LONGHOSTOUTPUT,AUTHOR:$AUTHOR,COMMENT:$COMMENT}' | /usr/bin/curl --fail-with-body --silent --show-error --request POST --header 'Content-Type: application/json' --data-binary @- 'https://OPSKNIGHT_HOST/api/integrations/nagios?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY'
}

define command {
    command_name notify-service-by-opsknight
    command_line /usr/bin/jq -cn --arg NOTIFICATIONTYPE "$NOTIFICATIONTYPE$" --arg HOSTNAME "$HOSTNAME$" --arg HOSTADDRESS "$HOSTADDRESS$" --arg HOSTSTATE "$HOSTSTATE$" --arg SERVICEDESC "$SERVICEDESC$" --arg SERVICESTATE "$SERVICESTATE$" --arg SERVICEOUTPUT "$SERVICEOUTPUT$" --arg LONGSERVICEOUTPUT "$LONGSERVICEOUTPUT$" --arg AUTHOR "$NOTIFICATIONAUTHOR$" --arg COMMENT "$NOTIFICATIONCOMMENT$" '{NOTIFICATIONTYPE:$NOTIFICATIONTYPE,HOSTNAME:$HOSTNAME,HOSTADDRESS:$HOSTADDRESS,HOSTSTATE:$HOSTSTATE,SERVICEDESC:$SERVICEDESC,SERVICESTATE:$SERVICESTATE,SERVICEOUTPUT:$SERVICEOUTPUT,LONGSERVICEOUTPUT:$LONGSERVICEOUTPUT,AUTHOR:$AUTHOR,COMMENT:$COMMENT}' | /usr/bin/curl --fail-with-body --silent --show-error --request POST --header 'Content-Type: application/json' --data-binary @- 'https://OPSKNIGHT_HOST/api/integrations/nagios?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY'
}
```

Replace placeholders before loading the configuration. If your configuration policy forbids secrets in command definitions, call a root-owned wrapper script that reads the URL from a restricted file and performs the same `jq`/`curl` operation.

Assign the host command to host notifications and the service command to service notifications. Include problem, recovery, acknowledgment, flapping, downtime, and custom notification options only if you want those lifecycle signals in OpsKnight. Validate configuration with your Nagios verification command before a reload.

## Action and severity contract

| Nagios notification/state                                                   | OpsKnight action                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Notification type contains `RECOVERY`                                       | Resolve                                                       |
| Type contains `ACK`, `ACKNOWLEDGEMENT`, `DOWNTIME`, `FLAPPING`, or `CUSTOM` | Acknowledge an existing match; does not create a new incident |
| Service state `OK`                                                          | Resolve                                                       |
| Host state `UP` with no service state                                       | Resolve                                                       |
| Every other problem state                                                   | Trigger                                                       |

Trigger/ack severity is critical for service `CRITICAL` or host `DOWN`, warning for service `WARNING`, and error for service `UNKNOWN` or host `UNREACHABLE`. Recovery is info. Service urgency rules still determine final incident urgency and paging.

Downtime and flapping notifications are **not suppressed or ignored** by the adapter; they become acknowledge actions. If no matching active incident exists, they do not create one.

## Correlation

- Service key: `nagios-<normalized-host>-<normalized-service>`
- Host key: `nagios-<normalized-host>`

Whitespace becomes hyphens, values are lowercased, and each component is limited to 100 characters. Renaming a host or service changes the key and can prevent recovery from matching the old incident.

## Request security

OpsKnight always validates the integration key. The optional generic signature requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`.

The direct command above does not generate that signature. Leave the OpsKnight signing secret unset unless a wrapper computes it over the exact `jq` output. Use HTTPS, restrict egress and secret-file permissions, and rotate a leaked integration URL.

## Validate end to end

1. Run Nagios configuration verification and reload only after it passes.
2. Force one disposable service to a hard `CRITICAL` state and confirm HTTP `202` in notification-command logs.
3. Confirm one OpsKnight incident uses the expected host/service key.
4. Acknowledge in Nagios and confirm OpsKnight acknowledges the same incident.
5. Restore the service to `OK` and confirm recovery resolves it.
6. Verify OpsKnight's schedule, escalation, and notification delivery separately.

## Troubleshooting

**Incidents show `unknown-host`**

The payload used unsupported snake_case field names or the macro rendered empty. Inspect the JSON from `jq`; use `HOSTNAME`/`hostname` and `SERVICEDESC`/`servicedesc` exactly.

**Nagios logs curl exit 22**

`--fail-with-body` reports a non-2xx response. Inspect the body: `401` means key/signature failure, `400` means invalid JSON/schema, and `429` means the per-integration limit was exceeded.

**Recovery does not match**

Compare hostname and service description between problem and recovery. The notification type should be `RECOVERY`, or the state must be `OK`/host-only `UP`.

**Output breaks the command**

Keep `jq --arg` and `--data-binary @-`; do not insert macro output into hand-built JSON. Review `illegal_macro_output_chars` and use a wrapper script if monitored object names contain shell-sensitive content.

## Related topics

- [Nagios notification types](https://assets.nagios.com/downloads/nagioscore/docs/nagioscore/4/en/notifications.html)
- [Nagios macro reference](https://assets.nagios.com/downloads/nagioscore/docs/nagioscore/4/en/macrolist.html)
- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
