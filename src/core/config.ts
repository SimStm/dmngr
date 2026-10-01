import { homedir } from "node:os";
import { join } from "node:path";
import { StateError, errorMessage } from "./errors.ts";
import { readJsonIfExists, writeFileAtomic, ensureDir, isDirectory, isWritableDirectory, expandHome, pathExists } from "./fsx.ts";
import { ensureStateDir, configPath } from "./paths.ts";
import { InstallError, UsageError } from "./errors.ts";

export type ElevateMode = "osascript" | "sudo" | "none";

export interface Config {
  schemaVersion: number;
  /** Destino de bundles .app; null = /Applications com fallback para ~/Applications. */
  destinationAppDir: string | null;
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
  elevate: ElevateMode;
  maxDownloadBytes: number;
  keepDownloads: boolean;
}

export const DEFAULT_MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export function defaultConfig(): Config {
  return {
    schemaVersion: 1,
    destinationAppDir: null,
    allowHttp: false,
    allowPrivateNetwork: false,
    elevate: "osascript",
    maxDownloadBytes: DEFAULT_MAX_DOWNLOAD_BYTES,
    keepDownloads: false,
  };
}

export async function loadConfig(): Promise<Config> {
  const raw = await readJsonIfExists<unknown>(configPath());
  if (raw === null) return defaultConfig();
  return validateConfig(raw);
}

export async function saveConfig(config: Config): Promise<void> {
  await ensureStateDir();
  await writeFileAtomic(configPath(), `${JSON.stringify(config, null, 2)}\n`, 0o600);
}

export function validateConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new StateError(`config.json inválido: ${configPath()}`, {
      hint: "apague o arquivo ou corrija o JSON",
    });
  }
  const obj = raw as Record<string, unknown>;
  const config = defaultConfig();
  const source = configPath();

  if (obj.schemaVersion !== undefined) {
    if (typeof obj.schemaVersion !== "number") {
      throw new StateError(`schemaVersion inválido em ${source}`);
    }
    if (obj.schemaVersion > config.schemaVersion) {
      throw new StateError(`config.json usa schemaVersion ${obj.schemaVersion}, mas esta versão do dmngr suporta até ${config.schemaVersion}`, {
        hint: "atualize o dmngr",
      });
    }
  }

  if (obj.destinationAppDir !== undefined) {
    const value = obj.destinationAppDir;
    if (value !== null && typeof value !== "string") {
      throw new StateError(`destinationAppDir inválido em ${source}`);
    }
    config.destinationAppDir = value === null ? null : value;
  }

  config.allowHttp = readBoolean(obj, "allowHttp", config.allowHttp, source);
  config.allowPrivateNetwork = readBoolean(obj, "allowPrivateNetwork", config.allowPrivateNetwork, source);
  config.keepDownloads = readBoolean(obj, "keepDownloads", config.keepDownloads, source);

  if (obj.elevate !== undefined) {
    if (obj.elevate !== "osascript" && obj.elevate !== "sudo" && obj.elevate !== "none") {
      throw new StateError(`elevate inválido em ${source} (use "osascript", "sudo" ou "none")`);
    }
    config.elevate = obj.elevate;
  }

  if (obj.maxDownloadBytes !== undefined) {
    if (typeof obj.maxDownloadBytes !== "number" || !Number.isFinite(obj.maxDownloadBytes) || obj.maxDownloadBytes <= 0) {
      throw new StateError(`maxDownloadBytes inválido em ${source}`);
    }
    config.maxDownloadBytes = obj.maxDownloadBytes;
  }

  return config;
}

function readBoolean(obj: Record<string, unknown>, key: string, fallback: boolean, source: string): boolean {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new StateError(`${key} inválido em ${source} (esperado booleano)`);
  return value;
}

/**
 * Destino efetivo dos bundles .app: flag > config > /Applications (se gravável) > ~/Applications.
 */
export async function resolveDestinationDir(explicit: string | undefined): Promise<string> {
  const config = await loadConfig();
  return await resolveDestinationDirFor(config, explicit);
}

export async function resolveDestinationDirFor(config: Config, explicit: string | undefined): Promise<string> {
  if (explicit !== undefined && explicit.trim().length > 0) {
    const dir = expandHome(explicit.trim());
    await assertUsableDestination(dir, "flag --destination");
    return dir;
  }
  if (config.destinationAppDir !== null) {
    await assertUsableDestination(expandHome(config.destinationAppDir), "config.json");
    return expandHome(config.destinationAppDir);
  }
  const preferred = "/Applications";
  if (await isWritableDirectory(preferred)) return preferred;
  const fallback = join(homedir(), "Applications");
  await ensureDir(fallback, 0o755);
  if (!(await isWritableDirectory(fallback))) {
    throw new InstallError(`sem permissão de escrita em ${preferred} e em ${fallback}`, {
      hint: "informe um diretório com --destination",
    });
  }
  return fallback;
}

async function assertUsableDestination(dir: string, origin: string): Promise<void> {
  if (!(await pathExists(dir))) {
    try {
      await ensureDir(dir, 0o755);
    } catch (error) {
      throw new UsageError(`não foi possível criar o destino ${dir}: ${errorMessage(error)}`, { details: { origin } });
    }
  }
  if (!(await isDirectory(dir))) {
    throw new UsageError(`destino não é um diretório: ${dir}`, { details: { origin } });
  }
  if (!(await isWritableDirectory(dir))) {
    throw new InstallError(`sem permissão de escrita em ${dir}`, {
      hint: `origem: ${origin}; escolha outro diretório com --destination`,
    });
  }
}
