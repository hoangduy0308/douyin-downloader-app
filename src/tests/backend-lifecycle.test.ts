import {
  BackendLifecycle,
  type BackendDiagnostic,
  type BackendRuntime,
  type HealthProbe,
} from "../services/backendLifecycle";

class FakeRuntime implements BackendRuntime {
  public startCalls = 0;
  public stopCalls = 0;
  public diagnostics: BackendDiagnostic[] = [];
  public startError: Error | null = null;

  public async start(): Promise<void> {
    this.startCalls += 1;
    if (this.startError) {
      throw this.startError;
    }
  }

  public async stop(): Promise<void> {
    this.stopCalls += 1;
  }

  public async getDiagnostics(): Promise<BackendDiagnostic[]> {
    return [...this.diagnostics];
  }
}

describe("BackendLifecycle", () => {
  it("transitions to ready only after /api/v1/health reports healthy", async () => {
    const runtime = new FakeRuntime();
    const probes: HealthProbe[] = [
      { healthy: false, statusCode: 503, statusText: "Starting" },
      { healthy: true, statusCode: 200, statusText: "OK" },
    ];
    const lifecycle = new BackendLifecycle(runtime, {
      healthProbe: async () => probes.shift() ?? { healthy: true, statusCode: 200, statusText: "OK" },
      sleep: async () => undefined,
      now: (() => {
        let tick = 0;
        return () => ++tick;
      })(),
    });

    const result = await lifecycle.start({
      mode: "dev-python",
      configPath: "C:\\runtime\\managed-config.yml",
      outputPath: "C:\\DouyinDownloads",
      healthTimeoutMs: 100,
      healthPollMs: 1,
    });

    expect(runtime.startCalls).toBe(1);
    expect(result.state).toBe("ready");
    expect(result.detail).toContain("127.0.0.1:8787");
    expect(lifecycle.getDiagnostics().some((entry) => entry.source === "health")).toBe(true);
  });

  it("returns actionable error when process start fails", async () => {
    const runtime = new FakeRuntime();
    runtime.startError = new Error("spawn ENOENT");
    const lifecycle = new BackendLifecycle(runtime, {
      healthProbe: async () => ({ healthy: false, statusCode: 0, statusText: "No response" }),
      sleep: async () => undefined,
      now: () => 0,
    });

    const result = await lifecycle.start({
      mode: "dev-python",
      configPath: "C:\\runtime\\managed-config.yml",
      outputPath: "C:\\DouyinDownloads",
    });

    expect(result.state).toBe("error");
    expect(result.detail).toContain("Check diagnostics");
    expect(lifecycle.getDiagnostics().some((entry) => entry.message.includes("spawn ENOENT"))).toBe(true);
  });

  it("times out on health failure and cleans up only the managed process", async () => {
    const runtime = new FakeRuntime();
    const lifecycle = new BackendLifecycle(runtime, {
      healthProbe: async () => ({ healthy: false, statusCode: 503, statusText: "Starting" }),
      sleep: async () => undefined,
      now: (() => {
        let elapsed = 0;
        return () => {
          elapsed += 25;
          return elapsed;
        };
      })(),
    });

    const result = await lifecycle.start({
      mode: "dev-python",
      configPath: "C:\\runtime\\managed-config.yml",
      outputPath: "C:\\DouyinDownloads",
      healthTimeoutMs: 60,
      healthPollMs: 1,
    });

    expect(result.state).toBe("error");
    expect(result.detail).toContain("timeout");
    expect(runtime.stopCalls).toBe(1);
  });

  it("does not stop attached external backend on cleanup", async () => {
    const runtime = new FakeRuntime();
    const lifecycle = new BackendLifecycle(runtime, {
      healthProbe: async () => ({ healthy: true, statusCode: 200, statusText: "OK" }),
      sleep: async () => undefined,
      now: () => 1,
    });

    await lifecycle.start({
      mode: "attach",
      host: "127.0.0.1",
      port: 8787,
      configPath: "C:\\runtime\\managed-config.yml",
      outputPath: "C:\\DouyinDownloads",
    });
    const stopped = await lifecycle.stop();

    expect(stopped.state).toBe("stopped");
    expect(runtime.stopCalls).toBe(0);
    expect(
      lifecycle
        .getDiagnostics()
        .some((entry) => entry.message.includes("external backend left running")),
    ).toBe(true);
  });
});
