import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isTauriMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => mocks.isTauriMock(),
  invoke: (command: string, payload: unknown) => mocks.invokeMock(command, payload),
}));

import { CookieRecoveryService, TauriCookieRecoveryGateway } from "../services/cookieRecovery";

describe("Cookie recovery cross-layer contract", () => {
  beforeEach(() => {
    mocks.isTauriMock.mockReset();
    mocks.invokeMock.mockReset();
    mocks.isTauriMock.mockReturnValue(true);
  });

  it("maps native failed status to renderer failed guidance and preserves diagnostics", async () => {
    mocks.invokeMock.mockResolvedValue({
      status: "failed",
      exitCode: 1,
      diagnostics: ["Missing required cookie keys: msToken"],
      error: "Cookie capture completed with missing required keys.",
    });
    const service = new CookieRecoveryService(new TauriCookieRecoveryGateway());

    const result = await service.captureAndCommit({ browser: "chromium" });

    expect(mocks.invokeMock).toHaveBeenCalledWith("cookie_capture_and_commit", {
      request: { browser: "chromium" },
    });
    expect(result.status).toBe("failed");
    expect(result.primaryMessage).toBe(
      "Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.",
    );
    expect(result.diagnostics).toEqual(["Missing required cookie keys: msToken"]);
    expect(Object.prototype.hasOwnProperty.call(result, "cookies")).toBe(false);
  });

  it("maps tauri-missing runtime state to manual/import fallback guidance", async () => {
    mocks.isTauriMock.mockReturnValue(false);
    const service = new CookieRecoveryService(new TauriCookieRecoveryGateway());

    const result = await service.captureAndCommit({ browser: "firefox" });

    expect(mocks.invokeMock).not.toHaveBeenCalled();
    expect(result.status).toBe("missing-runtime");
    expect(result.primaryMessage).toBe(
      "Automatic cookie recovery is unavailable on this machine. Use manual/import cookies and retry.",
    );
    expect(result.diagnostics).toEqual(["Tauri runtime is unavailable."]);
  });
});
