import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauriCoreMocks = vi.hoisted(() => ({
  isTauri: vi.fn<() => boolean>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: tauriCoreMocks.isTauri,
}));

function setTauriIpcHint(value: ((message: unknown) => void) | undefined): void {
  const globalScope = globalThis as typeof globalThis & { __TAURI_IPC__?: (message: unknown) => void };
  if (value) {
    globalScope.__TAURI_IPC__ = value;
    return;
  }
  delete globalScope.__TAURI_IPC__;
}

function setTauriInternalsHint(value: Record<string, unknown> | undefined): void {
  const globalScope = globalThis as typeof globalThis & { __TAURI_INTERNALS__?: Record<string, unknown> };
  if (value) {
    globalScope.__TAURI_INTERNALS__ = value;
    return;
  }
  delete globalScope.__TAURI_INTERNALS__;
}

describe("isTauriRuntimeAvailable", () => {
  beforeEach(() => {
    tauriCoreMocks.isTauri.mockReset();
    tauriCoreMocks.isTauri.mockReturnValue(false);
    setTauriIpcHint(undefined);
    setTauriInternalsHint(undefined);
  });

  afterEach(() => {
    setTauriIpcHint(undefined);
    setTauriInternalsHint(undefined);
  });

  it("treats __TAURI_IPC__ as a runtime hint when core detection is false", async () => {
    setTauriIpcHint(() => undefined);

    const runtime = await import("../services/tauriBackendRuntime");

    expect(runtime.isTauriRuntimeAvailable()).toBe(true);
  });

  it("returns false when core detection is false and no tauri platform hint exists", async () => {
    const runtime = await import("../services/tauriBackendRuntime");

    expect(runtime.isTauriRuntimeAvailable()).toBe(false);
  });

  it("treats __TAURI_INTERNALS__ as a runtime hint when core detection is false", async () => {
    setTauriInternalsHint({ invoke: () => undefined });

    const runtime = await import("../services/tauriBackendRuntime");

    expect(runtime.isTauriRuntimeAvailable()).toBe(true);
  });
});
