const ENV_INTERPOLATION_PATTERN = /\$\{([^}]+)\}/g;

export function interpolateEnvVariables(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value.replace(ENV_INTERPOLATION_PATTERN, (_, name) => process.env[name] ?? "")
    ])
  );
}
