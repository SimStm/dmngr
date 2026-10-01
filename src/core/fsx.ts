import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export function randomSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function isWritableDirectory(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

export async function resolveRealPath(path: string): Promise<string> {
  return await realpath(path);
}

export async function readTextFile(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

export async function readJsonIfExists<T = unknown>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureDir(path: string, mode = 0o700): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  await chmod(path, mode).catch(() => {
    /* melhor esforço */
  });
}

export async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Escrita atômica: arquivo temporário + fsync + rename. */
export async function writeFileAtomic(file: string, data: string, mode = 0o600): Promise<void> {
  const dir = dirname(file);
  await ensureDir(dir, 0o700);
  const tmp = join(dir, `.${randomSuffix()}.tmp`);
  const handle = await open(tmp, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, file);
    await chmod(file, mode).catch(() => {
      /* melhor esforço */
    });
    await syncDirectory(dir);
  } catch (error) {
    await removePath(tmp).catch(() => {
      /* melhor esforço */
    });
    throw error;
  }
}

async function syncDirectory(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* fsync de diretório não é essencial no dia a dia */
  }
}

export async function sha256File(file: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  const stream = Bun.file(file).stream();
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

/** Lista de arquivos (com limite de profundidade) cujo basename casa com o filtro. */
export async function findFiles(root: string, filter: (name: string) => boolean, maxDepth = 2): Promise<string[]> {
  const found: string[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current.dir, entry.name);
      if (entry.isFile() && filter(entry.name)) found.push(path);
      else if (entry.isDirectory() && current.depth < maxDepth) queue.push({ dir: path, depth: current.depth + 1 });
    }
  }
  return found;
}

export function expandHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return join(process.env.HOME ?? "~", path.slice(2));
  return path;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
