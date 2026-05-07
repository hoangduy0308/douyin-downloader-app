import {
  BackendApiError,
  createBackendClient,
  type DownloadJobRequest,
  type JobListResponse,
} from "../services/backendClient";

function mockJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : "Error",
    json: async () => payload,
  } as Response;
}

describe("backendClient", () => {
  it("returns healthy status when /api/v1/health responds with healthy=true", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockJsonResponse({
        status: "ok",
        healthy: true,
      }),
    );
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    const result = await client.health();

    expect(result).toEqual({
      status: "ok",
      healthy: true,
    });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/health", {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });
  });

  it("throws BackendApiError when /api/v1/health responds with non-2xx", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse({ detail: "down" }, 503));
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    await expect(client.health()).rejects.toMatchObject({
      name: "BackendApiError",
      endpoint: "/api/v1/health",
      statusCode: 503,
    } satisfies Partial<BackendApiError>);
  });

  it("returns typed submit response when download job submit succeeds", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockJsonResponse({
        job_id: "job-123",
        status: "pending",
      }),
    );
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });
    const request: DownloadJobRequest = {
      url: "https://www.douyin.com/video/123",
    };

    const result = await client.createDownloadJob(request);

    expect(result).toEqual({
      jobId: "job-123",
      status: "pending",
    });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/download", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  });

  it("throws BackendApiError when download job submit fails", async () => {
    const fetcher = vi.fn().mockResolvedValue(mockJsonResponse({ detail: "invalid url" }, 400));
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    await expect(
      client.createDownloadJob({
        url: "not-a-douyin-url",
      }),
    ).rejects.toMatchObject({
      name: "BackendApiError",
      endpoint: "/api/v1/download",
      statusCode: 400,
    } satisfies Partial<BackendApiError>);
  });

  it("parses typed get job payload from backend shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockJsonResponse({
        job_id: "job-abc",
        status: "running",
        submitted_at: "2026-05-08T03:00:00Z",
        started_at: "2026-05-08T03:00:01Z",
        finished_at: null,
        total: 10,
        success: 2,
        failed: 1,
        skipped: 0,
        error: null,
      }),
    );
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    const result = await client.getJob("job-abc");

    expect(result).toEqual({
      jobId: "job-abc",
      status: "running",
      submittedAt: "2026-05-08T03:00:00Z",
      startedAt: "2026-05-08T03:00:01Z",
      finishedAt: null,
      counts: {
        total: 10,
        success: 2,
        failed: 1,
        skipped: 0,
      },
      error: null,
    });
  });

  it("parses empty listJobs response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockJsonResponse({
        jobs: [],
      }),
    );
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    const result = await client.listJobs();

    expect(result).toEqual<JobListResponse>({
      jobs: [],
    });
  });

  it("parses active jobs list from backend shape", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      mockJsonResponse({
        jobs: [
          {
            job_id: "job-1",
            status: "pending",
            submitted_at: "2026-05-08T03:00:00Z",
            started_at: null,
            finished_at: null,
            total: 1,
            success: 0,
            failed: 0,
            skipped: 0,
            error: null,
          },
        ],
      }),
    );
    const client = createBackendClient({
      baseUrl: "http://127.0.0.1:8787",
      fetcher,
    });

    const result = await client.listJobs();

    expect(result).toEqual<JobListResponse>({
      jobs: [
        {
          jobId: "job-1",
          status: "pending",
          submittedAt: "2026-05-08T03:00:00Z",
          startedAt: null,
          finishedAt: null,
          counts: {
            total: 1,
            success: 0,
            failed: 0,
            skipped: 0,
          },
          error: null,
        },
      ],
    });
  });
});
