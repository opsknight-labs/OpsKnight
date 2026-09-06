# Product notification guidelines

OpsKnight uses one notification surface: the Sonner-based toaster mounted in `src/app/providers.tsx`.
Do not add page-local toast containers or import Sonner directly.

## Usage

New code should import `notify` from `@/lib/toast`:

```ts
notify.success('Schedule saved');

notify.error('Responder could not be added', {
  description: 'Alex is already assigned to “Primary”. Remove them there before continuing.',
});

notify.warning('Coverage gap detected', {
  description: 'No responder is scheduled between 02:00 and 04:00 UTC.',
});
```

Existing components that use `useToast` are backed by the same product notification system through
`@/hooks/use-product-notification`.

## Content rules

- Say what happened in the title: `Schedule saved`, not `Success`.
- Explain how to recover in an error description.
- Name the affected object when it helps: responder, layer, service, or integration.
- Never display database errors, stack traces, status codes, or provider payloads.
- Use success for completed actions, info for neutral state, warning for risk, and error only when an
  action failed.
- Avoid firing a toast for every autosave keystroke. Notify only when attention or confirmation is
  useful.

Identical active messages are deduplicated. Success messages dismiss sooner; warnings and errors stay
visible longer and all messages can be closed manually.
