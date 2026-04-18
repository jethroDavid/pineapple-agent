export function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function assertValidHttpsWebhookBaseUrl(
  webhookBaseUrl: string,
  envVariableName: string
): void {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(webhookBaseUrl);
  } catch {
    throw new Error(`${envVariableName} must be a valid absolute HTTPS URL.`);
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error(`${envVariableName} must use https.`);
  }
}
