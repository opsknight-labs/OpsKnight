# Notification-delivery contract

`src/lib/notification-delivery.ts` owns channel names, delivery states, provider
dispatch, retry policy, and deduplication identity. Both first attempts and
durable retries use `dispatchNotificationAttempt`, so providers cannot behave
differently merely because an attempt is a retry.

## Guarantees

- Delivery intent identity includes incident, recipient, channel, and message.
  A resolved message cannot be suppressed by a recent triggered message.
- Retry uses one bounded exponential schedule and one maximum-attempt policy.
- Provider results are normalized to success, error, provider message ID, and
  skipped state.
- SMS and WhatsApp receive the durable notification ID for provider callback
  correlation.
- Slack incident delivery remains owned by the durable lifecycle/event outbox;
  the dispatcher marks that ownership without sending a duplicate message.
- Quiet hours, recipient selection, channel preference, and fallback order stay
  in `user-notifications.ts`; the dispatcher never broadens recipients.
- Provider callbacks update the same durable `Notification` record.

New channels must be added to the contract dispatcher and tested for both first
attempt and retry behavior. Channel adapters must not be imported directly by
`notifications.ts` or `notification-retry.ts`.
