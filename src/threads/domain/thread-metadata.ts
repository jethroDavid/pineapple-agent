import { z } from "zod";

export const threadMetadataSchema = z.object({
  provisionalTitle: z.boolean(),
  turnCount: z.number().int().min(0),
  categories: z.array(z.string().min(1)),
  enrichedAt: z.string().min(1).nullable()
});

const threadMetadataPatchSchema = threadMetadataSchema.partial();

export type ThreadMetadata = z.infer<typeof threadMetadataSchema>;
export type ThreadMetadataPatch = z.infer<typeof threadMetadataPatchSchema>;

export function createThreadMetadata(
  patch: ThreadMetadataPatch = {}
): ThreadMetadata {
  return threadMetadataSchema.parse({
    provisionalTitle: true,
    turnCount: 0,
    categories: [],
    enrichedAt: null,
    ...patch
  });
}

export function mergeThreadMetadata(
  metadata: ThreadMetadata,
  patch: ThreadMetadataPatch
): ThreadMetadata {
  return threadMetadataSchema.parse({
    ...metadata,
    ...patch
  });
}
