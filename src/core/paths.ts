import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ensureDir, randomSuffix } from "./fsx.ts";

/**
 * Diretório de estado (registro, config, temporários).
 * DMNGR_APP_SUPPORT_DIR permite isolar o estado em testes.
 */
export function stateDir(): string {
  const override = process.env.DMNGR_APP_SUPPORT_DIR;
  if (override && override.trim().length > 0) return resolve(override);
  return join(homedir(), "Library", "Application Support", "dmngr");
}

export function registryPath(): string {
  return join(stateDir(), "registry.json");
}

export function configPath(): string {
  return join(stateDir(), "config.json");
}

export function lockPath(): string {
  return join(stateDir(), "registry.lock");
}

export function tmpDir(): string {
  return join(stateDir(), "tmp");
}

export function downloadsDir(): string {
  return join(tmpDir(), "downloads");
}

export async function ensureStateDir(): Promise<void> {
  await ensureDir(stateDir(), 0o700);
}

export async function ensureTmpDir(): Promise<void> {
  await ensureDir(tmpDir(), 0o700);
}

export async function createTempDir(prefix: string): Promise<string> {
  await ensureTmpDir();
  const dir = join(tmpDir(), `${prefix}-${randomSuffix()}`);
  await ensureDir(dir, 0o700);
  return dir;
}

/** Caminho temporário que ainda NÃO existe (pkgutil --expand exige destino inexistente). */
export async function tempPath(prefix: string): Promise<string> {
  await ensureTmpDir();
  return join(tmpDir(), `${prefix}-${randomSuffix()}`);
}
