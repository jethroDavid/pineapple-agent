import { describe, expect, it } from "vitest";

import {
  getNextCronOccurrence,
  parseCronExpression
} from "../../src/adapters/cron/cron-expression.js";

describe("cron-expression", () => {
  it("supports six-field expressions with seconds", () => {
    const parsed = parseCronExpression("*/5 * * * * *");
    const next = getNextCronOccurrence(parsed, new Date("2026-04-19T00:00:02.200Z"));

    expect(next?.toISOString()).toBe("2026-04-19T00:00:05.000Z");
  });

  it("supports five-field expressions by defaulting seconds to zero", () => {
    const parsed = parseCronExpression("*/10 * * * *");
    const next = getNextCronOccurrence(parsed, new Date("2026-04-19T00:03:42.000Z"));

    expect(next?.toISOString()).toBe("2026-04-19T00:10:00.000Z");
  });

  it("supports month/day names", () => {
    const parsed = parseCronExpression("0 0 9 * JAN MON");
    const next = getNextCronOccurrence(parsed, new Date(2026, 0, 5, 8, 0, 0, 0));

    expect(next?.getFullYear()).toBe(2026);
    expect(next?.getMonth()).toBe(0);
    expect(next?.getDate()).toBe(5);
    expect(next?.getHours()).toBe(9);
    expect(next?.getMinutes()).toBe(0);
    expect(next?.getSeconds()).toBe(0);
  });

  it("rejects invalid expressions", () => {
    expect(() => parseCronExpression("invalid")).toThrow();
  });
});
