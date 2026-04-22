import { z } from "zod";

const telegramDeliveryContextSchema = z.object({
  chatId: z.string().min(1),
  chatType: z.string().min(1).nullable()
});

const deliveryContextSchema = z.object({
  telegram: telegramDeliveryContextSchema.nullable()
});

const threadMetadataSchemaBase = z.object({
  provisionalTitle: z.boolean(),
  turnCount: z.number().int().min(0),
  categories: z.array(z.string().min(1)),
  enrichedAt: z.string().min(1).nullable(),
  deliveryContext: deliveryContextSchema.default({
    telegram: null
  })
});

export const threadMetadataSchema = threadMetadataSchemaBase;
export const threadMetadataPatchSchema = threadMetadataSchemaBase.partial();

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
    deliveryContext: {
      telegram: null
    },
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
