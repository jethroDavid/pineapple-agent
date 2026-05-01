import { describe, expect, it } from "vitest";

import { resolveAdapterEnabled } from "../../src/adapters/adapter-enabled.js";

describe("resolveAdapterEnabled", () => {
  it("lets explicit false disable an adapter even when config exists", () => {
    expect(
      resolveAdapterEnabled({
        explicit: false,
        hasConfig: true
      })
    ).toBe(false);
  });

  it("lets explicit true enable an adapter even before config is validated", () => {
    expect(
      resolveAdapterEnabled({
        explicit: true,
        hasConfig: false
      })
    ).toBe(true);
  });

  it("auto-enables only when config exists if the flag is unset", () => {
    expect(
      resolveAdapterEnabled({
        explicit: undefined,
        hasConfig: true
      })
    ).toBe(true);
    expect(
      resolveAdapterEnabled({
        explicit: undefined,
        hasConfig: false
      })
    ).toBe(false);
  });
});
