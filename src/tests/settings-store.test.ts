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
    expect(writer.writes[0]).toEqual({
      path: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      contents: "path: C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads\n",
    });
    expect(snapshot).toEqual({
      configPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      outputPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\downloads",
      configVersion: 1,
      backendReadyConfigVersion: 0,
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
    expect(writer.writes[1]).toEqual({
      path: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      contents: "path: D:\\Media\\DouyinDownloads\n",
    });
    expect(snapshot).toEqual({
      configPath: "C:\\Users\\hdi\\AppData\\Local\\DouyinDownloaderApp\\runtime\\managed-config.yml",
      outputPath: "D:\\Media\\DouyinDownloads",
      configVersion: 2,
      backendReadyConfigVersion: 0,
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
});
