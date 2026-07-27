export function normalizeHeaders(
  entries: ReadonlyArray<readonly [string, string]>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of entries) {
    headers[name.trim().toLowerCase()] = value.trim();
  }

  return headers;
}
