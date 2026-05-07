export interface RuntimeSettingsSnapshot {
  configPath: string;
  outputPath: string;
  configVersion: number;
  backendReadyConfigVersion: number;
}

export interface RuntimeConfigWriter {
  resolveManagedConfigPath(): Promise<string>;
  resolveDefaultOutputPath(): Promise<string>;
  ensureDirectory(path: string): Promise<void>;
  writeConfigAtomic(path: string, contents: string): Promise<void>;
}

export class RuntimeSettingsStore {
  private state: RuntimeSettingsSnapshot | null = null;

  public constructor(private readonly writer: RuntimeConfigWriter) {}

  public async initialize(): Promise<RuntimeSettingsSnapshot> {
    if (this.state) {
      return this.snapshot();
    }

    const configPath = await this.writer.resolveManagedConfigPath();
    assertAbsolutePath(configPath, "Managed config path must be absolute");
    assertManagedConfigPath(configPath);

    const outputPath = await this.writer.resolveDefaultOutputPath();
    assertAbsolutePath(outputPath, "Output path must be absolute");

    await this.writer.ensureDirectory(outputPath);
    await this.writer.writeConfigAtomic(configPath, serializeRuntimeConfig(outputPath));

    this.state = {
      configPath,
      outputPath,
      configVersion: 1,
      backendReadyConfigVersion: 0,
    };
    return this.snapshot();
  }

  public async updateOutputPath(nextOutputPath: string): Promise<RuntimeSettingsSnapshot> {
    if (!this.state) {
      await this.initialize();
    }
    const current = this.state as RuntimeSettingsSnapshot;
    assertAbsolutePath(nextOutputPath, "Output path must be absolute");

    if (nextOutputPath === current.outputPath) {
      return this.snapshot();
    }

    await this.writer.ensureDirectory(nextOutputPath);
    await this.writer.writeConfigAtomic(current.configPath, serializeRuntimeConfig(nextOutputPath));

    this.state = {
      ...current,
      outputPath: nextOutputPath,
      configVersion: current.configVersion + 1,
    };
    return this.snapshot();
  }

  public markBackendReadyForCurrentConfig(): void {
    if (!this.state) {
      return;
    }
    this.state = {
      ...this.state,
      backendReadyConfigVersion: this.state.configVersion,
    };
  }

  public isReadyForSubmit(): boolean {
    if (!this.state) {
      return false;
    }
    return this.state.configVersion === this.state.backendReadyConfigVersion;
  }

  public snapshot(): RuntimeSettingsSnapshot {
    if (!this.state) {
      throw new Error("Runtime settings store is not initialized.");
    }
    return { ...this.state };
  }
}

export function serializeRuntimeConfig(outputPath: string): string {
  assertAbsolutePath(outputPath, "Output path must be absolute");
  return `path: ${outputPath}\n`;
}

function assertManagedConfigPath(path: string): void {
  const normalized = normalizeWindowsLikePath(path);
  if (normalized.endsWith("\\config.yml") || normalized.endsWith("\\config.example.yml")) {
    throw new Error("Managed config path must not target bundled backend config files");
  }
  if (normalized.includes("\\douyin-downloader\\config\\")) {
    throw new Error("Managed config path must stay outside backend config directories");
  }
}

function assertAbsolutePath(path: string, message: string): void {
  if (!isAbsolutePath(path)) {
    throw new Error(message);
  }
}

function isAbsolutePath(path: string): boolean {
  const windowsDriveAbsolute = /^[a-zA-Z]:[\\/]/.test(path);
  const windowsUncAbsolute = /^\\\\[^\\]+\\[^\\]+/.test(path);
  const unixAbsolute = path.startsWith("/");
  return windowsDriveAbsolute || windowsUncAbsolute || unixAbsolute;
}

function normalizeWindowsLikePath(path: string): string {
  return path.replace(/\//g, "\\").toLowerCase();
}
