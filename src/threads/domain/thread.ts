import { z } from "zod";
import {
  createThreadMetadata,
  mergeThreadMetadata,
  threadMetadataSchema,
  type ThreadMetadata,
  type ThreadMetadataPatch
} from "./thread-metadata.js";
import { formatProvisionalThreadTitle } from "../../utils/date.js";

const subjectBindingSchema = z
  .object({
    subjectType: z.string().min(1).nullable(),
    subjectId: z.string().min(1).nullable()
  })
  .refine(
    ({ subjectType, subjectId }) =>
      (subjectType === null && subjectId === null) ||
      (subjectType !== null && subjectId !== null),
    {
      message: "subjectType and subjectId must both be null or both be non-null"
    }
  );

const threadSchema = subjectBindingSchema.extend({
  threadId: z.uuid(),
  title: z.string().min(1).max(120).nullable(),
  description: z.string().min(1).max(280).nullable(),
  threadMetadata: threadMetadataSchema,
  lastResponseId: z.string().min(1).nullable(),
  closedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export type Thread = z.infer<typeof threadSchema>;

const newThreadSchema = z
  .object({
    subjectType: z.string().min(1).nullable().optional(),
    subjectId: z.string().min(1).nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    threadMetadata: threadMetadataSchema.partial().optional(),
    lastResponseId: z.string().min(1).nullable().optional()
  })
  .transform((input) => ({
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    title: normalizeNullableText(input.title),
    description: normalizeNullableText(input.description),
    threadMetadata: input.threadMetadata ?? {},
    lastResponseId: input.lastResponseId ?? null
  }))
  .pipe(newThreadSchemaBase());

export type NewThread = z.input<typeof newThreadSchema>;

function newThreadSchemaBase() {
  return subjectBindingSchema.extend({
    title: z.string().min(1).max(120).nullable(),
    description: z.string().min(1).max(280).nullable(),
    threadMetadata: threadMetadataSchema.partial(),
    lastResponseId: z.string().min(1).nullable()
  });
}

export function createThread(input: NewThread = {}): Thread {
  const now = new Date();
  const parsed = newThreadSchema.parse(input);
  const title = parsed.title ?? formatProvisionalThreadTitle(now);
  const metadata = mergeThreadMetadata(
    createThreadMetadata({
      provisionalTitle: parsed.title === null
    }),
    parsed.threadMetadata ?? {}
  );
  const normalizedMetadata =
    parsed.title === null
      ? metadata
      : mergeThreadMetadata(metadata, {
          provisionalTitle: false
        });

  return threadSchema.parse({
    threadId: crypto.randomUUID(),
    subjectType: parsed.subjectType,
    subjectId: parsed.subjectId,
    title,
    description: parsed.description,
    threadMetadata: normalizedMetadata,
    lastResponseId: parsed.lastResponseId ?? null,
    closedAt: null,
    createdAt: now,
    updatedAt: now
  });
}

export function restoreThread(input: Thread): Thread {
  return threadSchema.parse(input);
}

export function updateThreadLastResponse(
  thread: Thread,
  lastResponseId: string,
  updatedAt: Date = new Date()
): Thread {
  return threadSchema.parse({
    ...thread,
    lastResponseId,
    updatedAt
  });
}

export function applyThreadMetadataPatch(
  thread: Thread,
  patch: {
    title?: string | null;
    description?: string | null;
    threadMetadata?: ThreadMetadataPatch;
  },
  updatedAt: Date = new Date()
): Thread {
  return threadSchema.parse({
    ...thread,
    ...(patch.title === undefined
      ? {}
      : {
          title: normalizeNullableText(patch.title)
        }),
    ...(patch.description === undefined
      ? {}
      : {
          description: normalizeNullableText(patch.description)
        }),
    ...(patch.threadMetadata === undefined
      ? {}
      : {
          threadMetadata: mergeThreadMetadata(thread.threadMetadata, patch.threadMetadata)
        }),
    updatedAt
  });
}

export function closeThread(thread: Thread, closedAt: Date = new Date()): Thread {
  return threadSchema.parse({
    ...thread,
    closedAt,
    updatedAt: closedAt
  });
}

export function reopenThread(thread: Thread, reopenedAt: Date = new Date()): Thread {
  return threadSchema.parse({
    ...thread,
    closedAt: null,
    updatedAt: reopenedAt
  });
}

function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type { ThreadMetadata };
