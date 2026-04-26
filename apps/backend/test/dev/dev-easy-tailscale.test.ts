import { describe, expect, it } from "vitest";

import {
  defaultBackendPort,
  defaultLoopbackHost
} from "../../src/config/network-defaults.js";
import {
  ensureTailscaleFunnelPreflight,
  type DevEasyCommandResult,
  type DevEasyCommandRunner
} from "../../src/dev/dev-easy-tailscale.js";

describe("dev:easy tailscale preflight", () => {
  const requiredProxyTarget = `http://${defaultLoopbackHost}:${defaultBackendPort}`;

  it("fails when tailscale cli is missing", async () => {
    const runner = createRunner([
      {
        exitCode: null,
        stdout: "",
        stderr: "",
        errorCode: "ENOENT"
      }
    ]);

    await expect(
      ensureTailscaleFunnelPreflight({
        runCommand: runner.run
      })
    ).rejects.toThrow(/winget install --id Tailscale\.Tailscale -e/);
  });

  it("runs `tailscale up` when status is not running", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Stopped",
        Self: {
          Online: false
        }
      }),
      successResult(""),
      successJsonResult({
        BackendState: "Running",
        Self: {
          Online: true
        }
      }),
      successJsonResult({
        Web: {
          "example.ts.net:443": {
            Handlers: {
              "/": {
                Proxy: requiredProxyTarget
              }
            }
          }
        },
        AllowFunnel: {
          "example.ts.net:443": true
        }
      })
    ]);

    const preflight = await ensureTailscaleFunnelPreflight({
      runCommand: runner.run
    });

    expect(preflight.baseUrl).toBe("https://example.ts.net");
    expect(runner.calls).toContainEqual(["tailscale", "up"]);
  });

  it("fails when `tailscale up` cannot recover a stopped daemon", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Stopped"
      }),
      {
        exitCode: 1,
        stdout: "",
        stderr: "authentication required"
      }
    ]);

    await expect(
      ensureTailscaleFunnelPreflight({
        runCommand: runner.run
      })
    ).rejects.toThrow(/tailscale up.*authentication required/i);
  });

  it("fails when funnel is not enabled", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Running",
        Self: {
          Online: true
        }
      }),
      successJsonResult({
        Web: {},
        AllowFunnel: {}
      })
    ]);

    await expect(
      ensureTailscaleFunnelPreflight({
        runCommand: runner.run
      })
    ).rejects.toThrow(/Funnel is not enabled/i);
  });

  it("auto-enables funnel when missing when enabled by option", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Running",
        Self: {
          Online: true
        }
      }),
      successJsonResult({
        Web: {},
        AllowFunnel: {}
      }),
      successResult(""),
      successJsonResult({
        Web: {
          "example.ts.net:443": {
            Handlers: {
              "/": {
                Proxy: requiredProxyTarget
              }
            }
          }
        },
        AllowFunnel: {
          "example.ts.net:443": true
        }
      })
    ]);

    const preflight = await ensureTailscaleFunnelPreflight({
      runCommand: runner.run,
      autoEnableFunnelWhenMissing: true
    });

    expect(preflight.baseUrl).toBe("https://example.ts.net");
    expect(preflight.funnelAutoEnabled).toBe(true);
    expect(runner.calls).toContainEqual([
      "tailscale",
      "funnel",
      "--bg",
      String(defaultBackendPort)
    ]);
  });

  it("fails when auto-enabling funnel fails", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Running",
        Self: {
          Online: true
        }
      }),
      successJsonResult({
        Web: {},
        AllowFunnel: {}
      }),
      {
        exitCode: 1,
        stdout: "",
        stderr: "permission denied"
      }
    ]);

    await expect(
      ensureTailscaleFunnelPreflight({
        runCommand: runner.run,
        autoEnableFunnelWhenMissing: true
      })
    ).rejects.toThrow(
      new RegExp(
        `tailscale funnel --bg ${defaultBackendPort}.*permission denied`,
        "i"
      )
    );
  });

  it("fails when funnel root path points to a different proxy target", async () => {
    const runner = createRunner([
      successResult("1.0.0"),
      successJsonResult({
        BackendState: "Running",
        Self: {
          Online: true
        }
      }),
      successJsonResult({
        Web: {
          "example.ts.net:443": {
            Handlers: {
              "/": {
                Proxy: `http://${defaultLoopbackHost}:4000`
              }
            }
          }
        },
        AllowFunnel: {
          "example.ts.net:443": true
        }
      })
    ]);

    await expect(
      ensureTailscaleFunnelPreflight({
        runCommand: runner.run
      })
    ).rejects.toThrow(
      new RegExp(`${escapeRegex(requiredProxyTarget)}.*${escapeRegex(`http://${defaultLoopbackHost}:4000`)}`, "i")
    );
  });
});

function successResult(stdout: string): DevEasyCommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: ""
  };
}

function successJsonResult(value: unknown): DevEasyCommandResult {
  return successResult(JSON.stringify(value));
}

function createRunner(results: DevEasyCommandResult[]): {
  run: DevEasyCommandRunner;
  calls: Array<[string, ...string[]]>;
} {
  const queue = [...results];
  const calls: Array<[string, ...string[]]> = [];

  return {
    calls,
    run: async (command, args) => {
      calls.push([command, ...args]);
      const next = queue.shift();

      if (!next) {
        throw new Error(`No queued command result for ${command} ${args.join(" ")}`);
      }

      return next;
    }
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
