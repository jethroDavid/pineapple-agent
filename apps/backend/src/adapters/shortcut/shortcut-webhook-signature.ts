import { createHmac, timingSafeEqual } from "node:crypto";

export const shortcutWebhookSignatureHeaders = [
  "payload-signature",
  "shortcut-signature",
  "x-shortcut-signature"
] as const;

export function verifyShortcutWebhookSignature(options: {
  rawBody: Buffer;
  secret: string;
  signature: string | null;
}): boolean {
  if (options.signature === null) {
    return false;
  }

  const digest = createHmac("sha256", options.secret).update(options.rawBody).digest("hex");
  const expectedSignatures = [digest, `sha256=${digest}`];

  return expectedSignatures.some((expectedSignature) =>
    signaturesEqual(expectedSignature, options.signature!)
  );
}

export function getShortcutWebhookSignature(
  headers: Record<string, string | string[] | undefined>
): string | null {
  for (const headerName of shortcutWebhookSignatureHeaders) {
    const headerValue = headers[headerName];

    if (typeof headerValue === "string" && headerValue.trim().length > 0) {
      return headerValue.trim();
    }

    if (Array.isArray(headerValue) && typeof headerValue[0] === "string") {
      return headerValue[0].trim();
    }
  }

  return null;
}

function signaturesEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}
