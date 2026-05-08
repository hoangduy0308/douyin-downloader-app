import { RuntimeSettingsStore, type RuntimeConfigWriter } from "../services/settingsStore";

class FakeRuntimeConfigWriter implements RuntimeConfigWriter {
  public writes: Array<{ path: string; contents: string }> = [];
  public ensuredPaths: string[] = [];

  public constructor(
    private readonly managedConfigPath: string,
    private readonly defaultOutputPath: string,
  ) {}

  public async resolveManagedConfigPath(): Promise<string> {
    return this.managedConfigPath;
  }

  public async resolveDefaultOutputPath(): Promise<string> {
    return this.defaultOutputPath;
  }

  public async ensureDirectory(path: string): Promise<void> {
    this.ensuredPaths.push(path);
  }

  public async writeConfigAtomic(path: string, contents: string): Promise<void> {
    this.writes.push({ path, contents });
  }
}

describe("RuntimeSettingsStore", () => {
  it("writes runtime config atomically for the default session output folder", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);

    const snapshot = await store.initialize();

    expect(writer.ensuredPaths).toEqual([
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    ]);
    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0].path).toBe(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
    );
    expect(writer.writes[0].contents).toContain(
      "path: C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    expect(writer.writes[0].contents).toContain("mode:");
    expect(writer.writes[0].contents).toContain("  - post");
    expect(snapshot).toMatchObject({
      configPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      outputPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
      configVersion: 1,
      backendReadyConfigVersion: 0,
      advancedOptions: {
        thread: 5,
        retry_times: 3,
      },
    });
  });

  it("updates output folder with an absolute path and advances config version", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);
    await store.initialize();

    const snapshot = await store.updateOutputPath("D:\\Media\\DouyinDownloads");

    expect(writer.ensuredPaths).toEqual([
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
      "D:\\Media\\DouyinDownloads",
    ]);
    expect(writer.writes).toHaveLength(2);
    expect(writer.writes[1].path).toBe(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
    );
    expect(writer.writes[1].contents).toContain("path: D:\\Media\\DouyinDownloads");
    expect(snapshot).toMatchObject({
      configPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      outputPath: "D:\\Media\\DouyinDownloads",
      configVersion: 2,
      backendReadyConfigVersion: 0,
      advancedOptions: {
        thread: 5,
      },
    });
  });

  it("rejects relative output folders", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);
    await store.initialize();

    await expect(store.updateOutputPath(".\\relative")).rejects.toThrow(
      "Output path must be a Windows absolute path",
    );
  });

  it("rejects non-windows absolute output folders during initialize", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "/tmp/downloads",
    );
    const store = new RuntimeSettingsStore(writer);

    await expect(store.initialize()).rejects.toThrow("Output path must be a Windows absolute path");
  });

  it("rejects non-windows absolute managed config paths during initialize", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "/tmp/managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);

    await expect(store.initialize()).rejects.toThrow("Managed config path must be a Windows absolute path");
  });

  it("tracks backend readiness against current config version", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);
    await store.initialize();

    expect(store.isReadyForSubmit()).toBe(false);

    store.markBackendReadyForCurrentConfig();
    expect(store.isReadyForSubmit()).toBe(true);

    await store.updateOutputPath("D:\\Media\\DouyinDownloads");
    expect(store.isReadyForSubmit()).toBe(false);
  });

  it("serializes scoped advanced options into managed config without deferred keys", async () => {
    const writer = new FakeRuntimeConfigWriter(
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
    );
    const store = new RuntimeSettingsStore(writer);
    await store.initialize();

    await store.updateAdvancedOptions({
      music: false,
      thread: 7,
      mode: ["post", "mix"],
      number: {
        post: 12,
        like: 0,
        mix: 5,
        music: 0,
        collect: 0,
        collectmix: 0,
      },
      increase: {
        post: true,
        like: true,
        mix: false,
        music: false,
      },
      proxy: "http://127.0.0.1:7890",
    });

    expect(writer.writes).toHaveLength(2);
    expect(writer.writes[1].contents).toContain("path: C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads");
    expect(writer.writes[1].contents).toContain("music: false");
    expect(writer.writes[1].contents).toContain("thread: 7");
    expect(writer.writes[1].contents).toContain("mode:");
    expect(writer.writes[1].contents).toContain("  - post");
    expect(writer.writes[1].contents).toContain("  - mix");
    expect(writer.writes[1].contents).toContain("proxy: \"http://127.0.0.1:7890\"");
    expect(writer.writes[1].contents).not.toContain("comments:");
    expect(writer.writes[1].contents).not.toContain("transcript:");
    expect(writer.writes[1].contents).not.toContain("live:");
    expect(writer.writes[1].contents).not.toContain("notifications:");
    expect(writer.writes[1].contents).not.toContain("server:");
  });
});
