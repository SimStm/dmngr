import { open, readFile, rm } from "node:fs/promises";
import { InternalError, StateError } from "../errors.ts";
import { sleep } from "../fsx.ts";
import { ensureStateDir, lockPath } from "../paths.ts";

interface LockInfo {
  pid: number;
  startedAt: string;
}

let heldByThisProcess = 0;

/**
 * Lock cooperativo via arquivo com O_EXCL. Não existe flock no runtime,
 * então o lock é um arquivo contendo pid + startedAt com detecção de staleness.
 */
export async function acquireLock(options: { timeoutMs?: number } = {}): Promise<() => Promise<void>> {
  if (heldByThisProcess > 0) {
    throw new InternalError("lock do registro já adquirido neste processo");
  }
  const timeoutMs = options.timeoutMs ?? 10_000;
  const path = lockPath();
  await ensureStateDir();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const handle = await open(path, "wx", 0o600);
      const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
      await handle.writeFile(JSON.stringify(info));
      await handle.sync();
      await handle.close();
      heldByThisProcess += 1;
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        heldByThisProcess -= 1;
        await rm(path, { force: true }).catch(() => {
          /* melhor esforço */
        });
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") {
        throw new StateError(`não foi possível criar o lock em ${path}`, { cause: error });
      }
      if (await isStaleLock(path)) {
        await rm(path, { force: true }).catch(() => {
          /* melhor esforço */
        });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new StateError("o registro está em uso por outro processo", {
          hint: `aguarde ou, se não houver outro dmngr rodando, remova ${path}`,
          details: { lockFile: path },
        });
      }
      await sleep(120);
    }
  }
}

export async function withLock<T>(fn: () => Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  const release = await acquireLock(options);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function isStaleLock(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (typeof parsed.pid === "number" && parsed.pid > 0) {
      if (parsed.pid === process.pid) return false; // segurança extra; já bloqueado por heldByThisProcess
      return !isProcessAlive(parsed.pid);
    }
    return true;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === "EPERM";
  }
}
