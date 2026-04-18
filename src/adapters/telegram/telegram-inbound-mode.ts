export const telegramInboundMode = {
  outboundOnly: "outbound_only",
  polling: "polling",
  webhook: "webhook"
} as const;

export type TelegramInboundMode =
  (typeof telegramInboundMode)[keyof typeof telegramInboundMode];
