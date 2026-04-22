import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { FileTelegramThreadSelectionStore } from "../../src/adapters/telegram/telegram-thread-selection-store.js";

describe("FileTelegramThreadSelectionStore", () => {
  it("persists the current thread per Telegram context", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pineapple-telegram-selection-"));
    const filePath = join(dir, "thread-selection.json");
    const store = new FileTelegramThreadSelectionStore({
      filePath
    });

    await store.initialize();
    expect(await store.getCurrent("5001")).toBeNull();

    await store.setCurrent("5001", "f84f61d3-465d-42aa-bf8f-9e3949713fb5");

    expect(await store.getCurrent("5001")).toBe("f84f61d3-465d-42aa-bf8f-9e3949713fb5");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      contexts: {
        "5001": "f84f61d3-465d-42aa-bf8f-9e3949713fb5"
      }
    });
  });
});
