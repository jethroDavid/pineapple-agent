import { describe, expect, it } from "vitest";

import {
  defaultBackendPort,
  defaultLoopbackHost
} from "../../src/config/network-defaults.js";
import {
  buildDevEasyRequiredProxyTarget,
  resolveDevEasyBackendHost,
  resolveDevEasyBackendPort
} from "../../src/dev/dev-easy-config.js";

describe("dev:easy config", () => {
  it("uses defaults when env overrides are missing", () => {
    const env: NodeJS.ProcessEnv = {};

    expect(resolveDevEasyBackendHost(env)).toBe(defaultLoopbackHost);
    expect(resolveDevEasyBackendPort(env)).toBe(defaultBackendPort);
    expect(buildDevEasyRequiredProxyTarget(env)).toBe(
      `http://${defaultLoopbackHost}:${defaultBackendPort}`
    );
  });

  it("uses env overrides for host and port", () => {
    const env: NodeJS.ProcessEnv = {
      DEV_EASY_BACKEND_HOST: "localhost",
      DEV_EASY_BACKEND_PORT: "3010"
    };

    expect(resolveDevEasyBackendHost(env)).toBe("localhost");
    expect(resolveDevEasyBackendPort(env)).toBe(3010);
    expect(buildDevEasyRequiredProxyTarget(env)).toBe("http://localhost:3010");
  });

  it("throws for invalid DEV_EASY_BACKEND_PORT", () => {
    const env: NodeJS.ProcessEnv = {
      DEV_EASY_BACKEND_PORT: "not-a-port"
    };

    expect(() => resolveDevEasyBackendPort(env)).toThrow(/DEV_EASY_BACKEND_PORT/);
  });
});
