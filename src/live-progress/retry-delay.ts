const MAX_DELAY_MS = 30_000;

export function retryDelay(attempt: number, baseDelayMs = 250): number {
  const normalizedAttempt = Math.max(0, Math.floor(attempt));
  const normalizedBase = Math.max(1, Math.floor(baseDelayMs));

  return Math.min(MAX_DELAY_MS, normalizedBase * 2 ** normalizedAttempt);
}
