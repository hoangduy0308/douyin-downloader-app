export type JobStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface BackendHealthResponse {
  status: string;
  healthy: boolean;
}

export interface DownloadJobRequest {
  url: string;
}

export interface DownloadJobSubmitResponse {
  jobId: string;
  status: JobStatus;
}

export interface JobCounts {
  total: number;
  success: number;
  failed: number;
  skipped: number;
}

export interface JobState {
  jobId: string;
  status: JobStatus;
  submittedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: JobCounts;
  error: string | null;
}

export interface JobListResponse {
  jobs: JobState[];
}

export interface BackendClient {
  health(): Promise<BackendHealthResponse>;
  createDownloadJob(request: DownloadJobRequest): Promise<DownloadJobSubmitResponse>;
  getJob(jobId: string): Promise<JobState>;
  listJobs(): Promise<JobListResponse>;
}

export type BackendClientFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface BackendClientOptions {
  baseUrl: string;
  fetcher?: BackendClientFetcher;
}

interface ApiJobState {
  job_id: string;
  status: JobStatus;
  submitted_at: string;
  started_at: string | null;
  finished_at: string | null;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  error: string | null;
}

interface ApiJobList {
  jobs: ApiJobState[];
}

interface ApiDownloadSubmit {
  job_id: string;
  status: JobStatus;
}

export class BackendApiError extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;
  public readonly detail: string;

  public constructor(endpoint: string, statusCode: number, detail: string) {
    super(`Backend API request failed (${statusCode}) at ${endpoint}: ${detail}`);
    this.name = "BackendApiError";
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.detail = detail;
  }
}

export function createBackendClient(options: BackendClientOptions): BackendClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetcher: BackendClientFetcher =
    options.fetcher ??
    ((input, init) => {
      if (typeof fetch !== "function") {
        throw new Error("Fetch API is unavailable in this runtime.");
      }
      return fetch(input, init);
    });

  const callJson = async <TResponse>(
    endpoint: string,
    init: RequestInit,
  ): Promise<TResponse> => {
    const response = await fetcher(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const detail = extractErrorDetail(payload);
      throw new BackendApiError(endpoint, response.status, detail);
    }
    return payload as TResponse;
  };

  return {
    async health(): Promise<BackendHealthResponse> {
      return callJson<BackendHealthResponse>("/api/v1/health", {
        method: "GET",
      });
    },
    async createDownloadJob(request: DownloadJobRequest): Promise<DownloadJobSubmitResponse> {
      const payload = await callJson<ApiDownloadSubmit>("/api/v1/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });
      return {
        jobId: payload.job_id,
        status: payload.status,
      };
    },
    async getJob(jobId: string): Promise<JobState> {
      const payload = await callJson<ApiJobState>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: "GET",
      });
      return parseApiJob(payload);
    },
    async listJobs(): Promise<JobListResponse> {
      const payload = await callJson<ApiJobList>("/api/v1/jobs", {
        method: "GET",
      });
      return {
        jobs: payload.jobs.map(parseApiJob),
      };
    },
  };
}

function parseApiJob(payload: ApiJobState): JobState {
  return {
    jobId: payload.job_id,
    status: payload.status,
    submittedAt: payload.submitted_at,
    startedAt: payload.started_at,
    finishedAt: payload.finished_at,
    counts: {
      total: payload.total,
      success: payload.success,
      failed: payload.failed,
      skipped: payload.skipped,
    },
    error: payload.error,
  };
}

function extractErrorDetail(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "detail" in payload) {
    const detail = payload.detail;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
  }
  return "Unknown backend error";
}
