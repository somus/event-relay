import { createHmac } from "node:crypto";

export function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!signatureHeader.startsWith("sha256=")) {
    return false;
  }

  const provided = signatureHeader.slice("sha256=".length).toLowerCase();
  const expected = createHmac("sha256", secret).update(body).digest("hex");

  return expected.startsWith(provided);
}
