export function isTransientProviderStatus(status: number): boolean {
  return status >= 400;
}
