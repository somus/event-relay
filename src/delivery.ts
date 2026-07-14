import pRetry from "p-retry";

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
  post(destination: string, body: string): Promise<void>;
}

export class HttpDeliveryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HttpDeliveryError";
  }
}

export interface DeliveryRetryOptions {
  retries?: number;
  minTimeout?: number;
}

export async function deliverWebhook(
  delivery: Delivery,
  client: WebhookClient,
  ledger: DeliveryLedger,
  retry: DeliveryRetryOptions = {},
): Promise<"delivered" | "already-delivered"> {
  if (await ledger.hasCompleted(delivery.id)) {
    return "already-delivered";
  }

  await pRetry(() => client.post(delivery.destination, delivery.body), {
    retries: retry.retries ?? 2,
    minTimeout: retry.minTimeout ?? 100,
    factor: 2,
    shouldRetry: ({ error }) => error instanceof HttpDeliveryError && error.status >= 500,
  });
  await ledger.markCompleted(delivery.id);
  return "delivered";
}
