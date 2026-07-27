export interface DeliveryWindow {
  startsAt: number;
  endsAt: number;
}

export function containsTimestamp(window: DeliveryWindow, timestamp: number): boolean {
  if (window.startsAt > window.endsAt) {
    throw new Error("Delivery window is inverted");
  }

  return timestamp >= window.startsAt && timestamp <= window.endsAt;
}
