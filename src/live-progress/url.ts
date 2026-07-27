export function buildDeliveryUrl(baseUrl: string, deliveryId: string): URL {
  const url = new URL(baseUrl);
  const normalizedId = deliveryId.trim();
  if (!normalizedId) {
    throw new Error("Delivery ID is required");
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/deliveries/${encodeURIComponent(normalizedId)}`;
  return url;
}
