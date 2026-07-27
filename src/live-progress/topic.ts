const TOPIC_PATTERN = /^[a-z][a-z0-9.-]{0,63}$/;

export function normalizeTopic(value: string): string {
  const topic = value.trim().toLowerCase();
  if (!TOPIC_PATTERN.test(topic)) {
    throw new Error("Invalid relay topic");
  }

  return topic;
}
