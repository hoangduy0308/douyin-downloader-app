import {
  CookieRecoveryService,
  type CookieRecoveryCommandRequest,
  type CookieRecoveryCommandResult,
  type CookieRecoveryGateway,
} from "../services/cookieRecovery";

class FakeCookieRecoveryGateway implements CookieRecoveryGateway {
  public lastRequest: CookieRecoveryCommandRequest | null = null;

  public constructor(private readonly result: CookieRecoveryCommandResult) {}

  public async captureAndCommit(request: CookieRecoveryCommandRequest): Promise<CookieRecoveryCommandResult> {
    this.lastRequest = request;
    return this.result;
  }
}

describe("CookieRecoveryService", () => {
  const baseRequest: CookieRecoveryCommandRequest = {
    browser: "chromium",
  };

  it("maps successful cookie capture and commits to the managed config path", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "success",
      exitCode: 0,
      diagnostics: ["stdout: [INFO] Saved cookies"],
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(gateway.lastRequest).toEqual({ browser: "chromium" });
    expect(result.status).toBe("success");
    expect(result.primaryMessage).toBe("Cookies were refreshed. Retry the failed download now.");
    expect(result.diagnostics).toEqual(["stdout: [INFO] Saved cookies"]);
    expect(Object.prototype.hasOwnProperty.call(result, "cookies")).toBe(false);
  });

  it("maps canceled capture to a non-destructive user action", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "cancelled",
      exitCode: null,
      diagnostics: ["stderr: capture canceled by user"],
      error: "user canceled",
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("cancelled");
    expect(result.primaryMessage).toBe("Cookie recovery was canceled. Existing cookies were unchanged.");
    expect(result.diagnostics).toEqual(["stderr: capture canceled by user"]);
  });

  it("maps missing runtime/dependency status to fallback guidance", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "missing-runtime",
      exitCode: null,
      diagnostics: ["Playwright is not installed"],
      error: "missing playwright",
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("missing-runtime");
    expect(result.primaryMessage).toBe(
      "Automatic cookie recovery is unavailable on this machine. Use manual/import cookies and retry.",
    );
    expect(result.diagnostics).toEqual(["Playwright is not installed"]);
  });

  it("does not expose cookie values to renderer-facing result payloads", async () => {
    const gateway = new FakeCookieRecoveryGateway(
      {
        status: "success",
        exitCode: 0,
        diagnostics: ["stdout: [INFO] Saved cookies"],
        cookies: {
          msToken: "ms-token",
          ttwid: "ttwid-token",
          odin_tt: "odin-token",
          passport_csrf_token: "csrf-token",
        },
      } as unknown as CookieRecoveryCommandResult,
    );
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("success");
    expect(result.primaryMessage).toBe("Cookies were refreshed. Retry the failed download now.");
    expect(Object.prototype.hasOwnProperty.call(result, "cookies")).toBe(false);
  });

  it("keeps raw process errors in diagnostics instead of the primary message", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "failed",
      exitCode: 1,
      diagnostics: ["Traceback: BrowserType.launch: Executable doesn't exist"],
      error: "BrowserType.launch: Executable doesn't exist",
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("failed");
    expect(result.primaryMessage).toBe("Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.");
    expect(result.primaryMessage).not.toContain("BrowserType.launch");
    expect(result.diagnostics[0]).toContain("BrowserType.launch");
  });

  it("treats unexpected backend statuses as failed contract drift", async () => {
    const gateway = new FakeCookieRecoveryGateway(
      {
        status: "unexpected-status",
        exitCode: 0,
        diagnostics: ["stdout: cookie output parsed but status was unexpected"],
      } as unknown as CookieRecoveryCommandResult,
    );
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("failed");
    expect(result.primaryMessage).toBe(
      "Cookie recovery returned an unexpected status. Check Logs and use manual/import fallback.",
    );
    expect(result.diagnostics).toContain("stdout: cookie output parsed but status was unexpected");
    expect(result.diagnostics).toContain(
      "Cookie recovery contract mismatch: unexpected status 'unexpected-status'.",
    );
  });
});
