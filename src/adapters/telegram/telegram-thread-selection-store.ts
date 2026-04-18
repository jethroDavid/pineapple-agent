import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const telegramThreadSelectionStateSchema = z.object({
  version: z.literal(1),
  contexts: z.record(z.string(), z.string().min(1))
});

type TelegramThreadSelectionState = z.infer<typeof telegramThreadSelectionStateSchema>;

export interface TelegramThreadSelectionStore {
  initialize(): Promise<void>;
  getCurrent(contextKey: string): Promise<string | null>;
  setCurrent(contextKey: string, threadId: string): Promise<void>;
}

interface FileTelegramThreadSelectionStoreOptions {
  filePath: string;
}

export class FileTelegramThreadSelectionStore
  implements TelegramThreadSelectionStore
{
  private readonly filePath: string;
  private initialized = false;

  constructor(options: FileTelegramThreadSelectionStoreOptions) {
    this.filePath = options.filePath;
  }

  async initialize(): Promise<void> {
    await this.ensureInitialized();
  }

  async getCurrent(contextKey: string): Promise<string | null> {
    const state = await this.readState();

    return state.contexts[contextKey] ?? null;
  }

  async setCurrent(contextKey: string, threadId: string): Promise<void> {
    const state = await this.readState();
    const nextState = telegramThreadSelectionStateSchema.parse({
      ...state,
      contexts: {
        ...state.contexts,
        [contextKey]: threadId
      }
    });

    await this.writeState(nextState);
  }

  private async readState(): Promise<TelegramThreadSelectionState> {
    await this.ensureInitialized();

    const raw = await readFile(this.filePath, "utf8");
    return telegramThreadSelectionStateSchema.parse(JSON.parse(raw));
  }

  private async writeState(state: TelegramThreadSelectionState): Promise<void> {
    await this.ensureInitialized();

    const tempFilePath = `${this.filePath}.tmp`;
    await writeFile(tempFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempFilePath, this.filePath);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, "utf8");
      telegramThreadSelectionStateSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFileError(error)) {
        await this.writeFreshState();
      } else {
        throw error;
      }
    }

    this.initialized = true;
  }

  private async writeFreshState(): Promise<void> {
    const initialState = telegramThreadSelectionStateSchema.parse({
      version: 1,
      contexts: {}
    });
    const tempFilePath = `${this.filePath}.tmp`;

    await writeFile(tempFilePath, `${JSON.stringify(initialState, null, 2)}\n`, "utf8");
    await rename(tempFilePath, this.filePath);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
