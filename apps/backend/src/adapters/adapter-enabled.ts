export function resolveAdapterEnabled(options: {
  explicit: boolean | undefined;
  hasConfig: boolean;
}): boolean {
  return options.explicit ?? options.hasConfig;
}
