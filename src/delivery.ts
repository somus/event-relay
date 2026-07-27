export interface Delivery {
  id: string;
  destination: string;
  body: string;
}

export interface DeliveryLedger {
  hasCompleted(deliveryId: string): Promise<boolean>;
  markCompleted(deliveryId: string): Promise<void>;
}

export interface WebhookClient {
  post(
    destination: string,
    body: string,
    options?: { idempotencyKey?: string },
  ): Promise<void>;
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  wait?: (delayMs: number) => Promise<void>;
}

export class HttpDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function deliverWebhook(
  delivery: Delivery,
  client: WebhookClient,
  ledger: DeliveryLedger,
  retry: RetryOptions = { maxAttempts: 3, initialDelayMs: 250 },
): Promise<"delivered" | "already-delivered"> {
  if (await ledger.hasCompleted(delivery.id)) {
    return "already-delivered";
  }

  const wait = retry.wait ?? ((delayMs) => Bun.sleep(delayMs));

  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    try {
      await client.post(delivery.destination, delivery.body);
      await ledger.markCompleted(delivery.id);
      return "delivered";
    } catch (error) {
      const retryable = error instanceof HttpDeliveryError && error.status >= 500;
      if (!retryable || attempt === retry.maxAttempts) {
        throw error;
      }

      await wait(retry.initialDelayMs * 2 ** (attempt - 1));
    }
  }

  throw new Error("delivery attempts exhausted");
}
