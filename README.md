# Event Relay

Event Relay delivers signed webhook events to customer endpoints. The worker records completed deliveries so queue retries do not resend an event that already finished successfully.

```bash
bun install
bun test
bun run typecheck
```
