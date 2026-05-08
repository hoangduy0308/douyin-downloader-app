import {
  isBatchRowRetryEligible,
  parseBatchQueueInput,
  summarizeBatchQueue,
  type BatchQueueRow,
} from "../services/batchQueue";

describe("parseBatchQueueInput", () => {
  it("creates waiting rows with stable ids for supported Douyin hosts", () => {
    const text = [
      "https://www.douyin.com/video/123",
      "https://v.douyin.com/abcde/",
      "https://www.iesdouyin.com/share/video/12345",
    ].join("\n");

    const result = parseBatchQueueInput(text);

    expect(result.rows.map((row) => row.id)).toEqual(["row-1", "row-2", "row-3"]);
    expect(result.rows.map((row) => row.status)).toEqual(["waiting", "waiting", "waiting"]);
    expect(result.rows.map((row) => row.normalizedUrl)).toEqual([
      "https://www.douyin.com/video/123",
      "https://v.douyin.com/abcde",
      "https://www.iesdouyin.com/share/video/12345",
    ]);
    expect(result.totals).toMatchObject({
      total: 3,
      waiting: 3,
      skipped: 0,
      readyToSubmit: 3,
    });
  });

  it("marks blank lines as skipped rows", () => {
    const text = ["https://www.douyin.com/video/1", "", "   ", "https://www.iesdouyin.com/share/video/2"].join(
      "\n",
    );

    const result = parseBatchQueueInput(text);

    expect(result.rows.map((row) => row.status)).toEqual([
      "waiting",
      "skipped",
      "skipped",
      "waiting",
    ]);
    expect(result.rows.map((row) => row.skipReason)).toEqual([
      null,
      "blank",
      "blank",
      null,
    ]);
    expect(result.totals).toMatchObject({
      total: 4,
      waiting: 2,
      skipped: 2,
      readyToSubmit: 2,
    });
  });

  it("rejects unsupported and lookalike hosts", () => {
    const text = [
      "https://www.tiktok.com/@abc/video/1",
      "https://douyin.com.evil.test/video/1",
      "https://www.iesdouyin.com.evil.test/share/video/2",
      "https://sub.douyin.com/video/3",
    ].join("\n");

    const result = parseBatchQueueInput(text);

    expect(result.rows.map((row) => row.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "waiting",
    ]);
    expect(result.rows.map((row) => row.skipReason)).toEqual([
      "unsupported_host",
      "unsupported_host",
      "unsupported_host",
      null,
    ]);
  });

  it("rejects non-http schemes even when hostname looks supported", () => {
    const text = [
      "ftp://www.douyin.com/video/1",
      "file://www.douyin.com/video/2",
      "https://www.douyin.com/video/3",
    ].join("\n");

    const result = parseBatchQueueInput(text);

    expect(result.rows.map((row) => row.status)).toEqual([
      "skipped",
      "skipped",
      "waiting",
    ]);
    expect(result.rows.map((row) => row.skipReason)).toEqual([
      "unsupported_host",
      "unsupported_host",
      null,
    ]);
    expect(result.rows[2].normalizedUrl).toBe("https://www.douyin.com/video/3");
  });

  it("marks duplicates as skipped using the normalized supported URL", () => {
    const text = [
      "https://www.douyin.com/video/777/",
      "https://www.douyin.com/video/777",
      "https://www.douyin.com/video/777#fragment",
      "https://www.douyin.com/video/777?from=home",
      "https://www.douyin.com/video/777?from=home",
    ].join("\n");

    const result = parseBatchQueueInput(text);

    expect(result.rows.map((row) => row.status)).toEqual([
      "waiting",
      "skipped",
      "skipped",
      "waiting",
      "skipped",
    ]);
    expect(result.rows.map((row) => row.skipReason)).toEqual([
      null,
      "duplicate",
      "duplicate",
      null,
      "duplicate",
    ]);
    expect(result.rows.map((row) => row.retryEligible)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("treats imported text content as multiline queue input", () => {
    const importedText = "https://www.douyin.com/video/100\ninvalid-url\nhttps://www.iesdouyin.com/share/video/200";

    const result = parseBatchQueueInput(importedText);

    expect(result.rows.map((row) => row.status)).toEqual([
      "waiting",
      "skipped",
      "waiting",
    ]);
    expect(result.rows[1]).toMatchObject({
      skipReason: "invalid_url",
      normalizedUrl: null,
    });
  });
});

describe("summarizeBatchQueue", () => {
  it("builds display-ready totals for mixed queue states", () => {
    const rows: BatchQueueRow[] = [
      {
        id: "row-1",
        sourceText: "https://www.douyin.com/video/1",
        normalizedUrl: "https://www.douyin.com/video/1",
        status: "waiting",
        skipReason: null,
        retryEligible: false,
        attempt: 0,
        currentJobId: null,
        lastJobId: null,
        lastError: null,
      },
      {
        id: "row-2",
        sourceText: "https://www.douyin.com/video/2",
        normalizedUrl: "https://www.douyin.com/video/2",
        status: "running",
        skipReason: null,
        retryEligible: false,
        attempt: 1,
        currentJobId: "job-2",
        lastJobId: null,
        lastError: null,
      },
      {
        id: "row-3",
        sourceText: "https://www.douyin.com/video/3",
        normalizedUrl: "https://www.douyin.com/video/3",
        status: "success",
        skipReason: null,
        retryEligible: false,
        attempt: 1,
        currentJobId: null,
        lastJobId: "job-3",
        lastError: null,
      },
      {
        id: "row-4",
        sourceText: "https://www.douyin.com/video/4",
        normalizedUrl: "https://www.douyin.com/video/4",
        status: "failed",
        skipReason: null,
        retryEligible: true,
        attempt: 2,
        currentJobId: null,
        lastJobId: "job-4",
        lastError: "timeout",
      },
      {
        id: "row-5",
        sourceText: "not-a-url",
        normalizedUrl: null,
        status: "skipped",
        skipReason: "invalid_url",
        retryEligible: false,
        attempt: 0,
        currentJobId: null,
        lastJobId: null,
        lastError: null,
      },
    ];

    const totals = summarizeBatchQueue(rows);

    expect(totals).toEqual({
      total: 5,
      waiting: 1,
      running: 1,
      success: 1,
      failed: 1,
      skipped: 1,
      retryEligible: 1,
      readyToSubmit: 1,
    });
  });
});

describe("isBatchRowRetryEligible", () => {
  it("allows retry only for failed terminal rows with normalized url and no active job", () => {
    const failedRow: BatchQueueRow = {
      id: "row-failed",
      sourceText: "https://www.douyin.com/video/10",
      normalizedUrl: "https://www.douyin.com/video/10",
      status: "failed",
      skipReason: null,
      retryEligible: true,
      attempt: 1,
      currentJobId: null,
      lastJobId: "job-10",
      lastError: "submit failed",
    };
    const skippedRow: BatchQueueRow = {
      ...failedRow,
      id: "row-skipped",
      status: "skipped",
      skipReason: "duplicate",
    };

    expect(isBatchRowRetryEligible(failedRow)).toBe(true);
    expect(isBatchRowRetryEligible(skippedRow)).toBe(false);
  });
});
