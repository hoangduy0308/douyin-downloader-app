import { BackendApiError } from "../services/backendClient";
import { mapFailedJobError, mapPollingRequestError } from "../services/errorMapper";

describe("errorMapper", () => {
  it("maps backend unreachable polling errors to restart guidance", () => {
    const mapped = mapPollingRequestError(new Error("network timeout while polling"));

    expect(mapped.message).toBe(
      "Downloader backend is not ready. Restart the app backend and try again.",
    );
    expect(mapped.diagnostics).toContain("network timeout");
  });

  it("maps 404 polling errors to missing-job guidance", () => {
    const mapped = mapPollingRequestError(new BackendApiError("/api/v1/jobs/job-1", 404, "missing"));

    expect(mapped.message).toBe(
      "This download job is no longer available. Start the download again.",
    );
    expect(mapped.diagnostics).toContain("404");
  });

  it("maps unsupported url failed-job errors", () => {
    const mapped = mapFailedJobError("RuntimeError: Unsupported URL format");

    expect(mapped?.message).toBe("This link is not supported by the current downloader.");
    expect(mapped?.diagnostics).toContain("Unsupported URL");
  });

  it("maps cookie/auth failed-job errors", () => {
    const mapped = mapFailedJobError("401 unauthorized: cookie expired, login required");

    expect(mapped?.message).toBe(
      "Douyin login cookies may be missing or expired. Cookie recovery is planned for a later phase; update cookies manually for now.",
    );
    expect(mapped?.diagnostics).toContain("401");
  });

  it("maps unknown failed-job errors to generic guidance", () => {
    const mapped = mapFailedJobError("Traceback: random backend error");

    expect(mapped?.message).toBe("Download failed. Check diagnostics for technical details.");
    expect(mapped?.diagnostics).toContain("random backend error");
  });

  it("returns null when failed-job error detail is absent", () => {
    expect(mapFailedJobError(null)).toBeNull();
  });
});
