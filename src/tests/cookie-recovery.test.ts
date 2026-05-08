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
    backendRoot: "F:\\Work\\DouyinDownload\\douyin-downloader",
    managedConfigPath: "F:\\Work\\DouyinDownload\\douyin-downloader-app\\.runtime\\managed-config.yml",
    outputPath: "F:\\Work\\DouyinDownload\\douyin-downloader-app\\.runtime\\cookies.capture.json",
    pythonExecutable: "python",
    browser: "chromium",
  };

  it("maps successful cookie capture and commits to the managed config path", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "success",
      exitCode: 0,
      diagnostics: ["stdout: [INFO] Saved cookies"],
      cookies: {
        msToken: "ms-token",
        ttwid: "ttwid-token",
        odin_tt: "odin-token",
        passport_csrf_token: "csrf-token",
      },
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(gateway.lastRequest?.managedConfigPath).toBe(baseRequest.managedConfigPath);
    expect(result.status).toBe("success");
    expect(result.primaryMessage).toBe("Cookies were refreshed. Retry the failed download now.");
    expect(result.diagnostics).toEqual(["stdout: [INFO] Saved cookies"]);
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

  it("rejects zero-exit captures when required cookie keys are missing", async () => {
    const gateway = new FakeCookieRecoveryGateway({
      status: "success",
      exitCode: 0,
      diagnostics: ["[WARN] Missing required cookie keys: ttwid"],
      cookies: {
        msToken: "ms-token",
        odin_tt: "odin-token",
        passport_csrf_token: "csrf-token",
      },
    });
    const service = new CookieRecoveryService(gateway);

    const result = await service.captureAndCommit(baseRequest);

    expect(result.status).toBe("failed");
    expect(result.primaryMessage).toBe("Could not refresh Douyin cookies. Check Logs for details and use manual/import fallback.");
    expect(result.diagnostics.join("\n")).toContain("Missing required cookie keys: ttwid");
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
});
