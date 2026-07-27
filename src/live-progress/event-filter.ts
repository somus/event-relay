export interface RelayEvent {
  id: string;
  topic: string;
  createdAt: number;
}

export function filterRecentEvents(
  events: readonly RelayEvent[],
  topic: string,
  cutoff: number,
): RelayEvent[] {
  return events.filter((event) => event.topic === topic && event.createdAt >= cutoff);
}
