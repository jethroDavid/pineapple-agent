import { describe, expect, it } from "vitest";

import { interpolateEnvVariables } from "../../src/agents/interpolate-env-variables.js";

describe("interpolateEnvVariables", () => {
  it("replaces ${VAR} placeholders from process env", () => {
    const previousValue = process.env.PINEAPPLE_INTERPOLATE_TEST;
    process.env.PINEAPPLE_INTERPOLATE_TEST = "resolved-value";

    try {
      expect(
        interpolateEnvVariables({
          STATIC: "unchanged",
          DYNAMIC: "prefix-${PINEAPPLE_INTERPOLATE_TEST}-suffix"
        })
      ).toEqual({
        STATIC: "unchanged",
        DYNAMIC: "prefix-resolved-value-suffix"
      });
    } finally {
      if (previousValue === undefined) {
        delete process.env.PINEAPPLE_INTERPOLATE_TEST;
      } else {
        process.env.PINEAPPLE_INTERPOLATE_TEST = previousValue;
      }
    }
  });

  it("uses an empty string when process env value is missing", () => {
    expect(
      interpolateEnvVariables({
        MISSING: "before-${PINEAPPLE_ENV_THAT_SHOULD_NOT_EXIST}-after"
      })
    ).toEqual({
      MISSING: "before--after"
    });
  });
});
