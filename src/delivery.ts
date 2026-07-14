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

export async function deliverWebhook(
  delivery: Delivery,
  client: WebhookClient,
  ledger: DeliveryLedger,
): Promise<"delivered" | "already-delivered"> {
  if (await ledger.hasCompleted(delivery.id)) {
    return "already-delivered";
  }

  await client.post(delivery.destination, delivery.body);
  await ledger.markCompleted(delivery.id);
  return "delivered";
}
