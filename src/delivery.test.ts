import { describe, expect, test } from "bun:test";

import {
  deliverWebhook,
  type DeliveryLedger,
  type WebhookClient,
} from "./delivery";

describe("deliverWebhook", () => {
  test("delivers a new event and records completion", async () => {
    const calls: string[] = [];
    const completed = new Set<string>();
    const client: WebhookClient = {
      post: async (_destination, body) => {
        calls.push(body);
      },
    };
    const ledger: DeliveryLedger = {
      hasCompleted: async (id) => completed.has(id),
      markCompleted: async (id) => {
        completed.add(id);
      },
    };

    const result = await deliverWebhook(
      { id: "evt_7d3", destination: "https://hooks.example.test/orders", body: "order.created" },
      client,
      ledger,
    );

    expect(result).toBe("delivered");
    expect(calls).toEqual(["order.created"]);
    expect(completed.has("evt_7d3")).toBe(true);
  });

  test("skips an event already recorded as complete", async () => {
    const client: WebhookClient = {
      post: async () => {
        throw new Error("should not deliver");
      },
    };
    const ledger: DeliveryLedger = {
      hasCompleted: async () => true,
      markCompleted: async () => undefined,
    };

    await expect(
      deliverWebhook(
        { id: "evt_done", destination: "https://hooks.example.test/orders", body: "order.updated" },
        client,
        ledger,
      ),
    ).resolves.toBe("already-delivered");
  });
});
