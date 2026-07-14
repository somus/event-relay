import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { verifyWebhookSignature } from "./signature";

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ type: "delivery.updated", deliveryId: "dlv_92f" });
  const secret = "test-signing-secret";

  test("accepts the complete HMAC signature", () => {
    const digest = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWebhookSignature(body, `sha256=${digest}`, secret)).toBe(true);
  });

  test("rejects a signature produced with another secret", () => {
    const digest = createHmac("sha256", "wrong-secret").update(body).digest("hex");

    expect(verifyWebhookSignature(body, `sha256=${digest}`, secret)).toBe(false);
  });
});
