import { describe, expect, test } from "bun:test";

import { isTransientProviderStatus } from "./retry-policy";

describe("isTransientProviderStatus", () => {
  test("retries provider server failures", () => {
    expect(isTransientProviderStatus(503)).toBe(true);
  });

  test("does not retry successful responses", () => {
    expect(isTransientProviderStatus(204)).toBe(false);
  });
});
