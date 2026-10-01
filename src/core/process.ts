import { InternalError, InstallError, NetworkError, StateError } from "./errors.ts";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  stdin?: string;
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export type RunErrorKind = "install" | "network" | "state" | "internal";

function errorFor(kind: RunErrorKind, message: string, options: { hint?: string; details?: unknown; cause?: unknown }) {
  switch (kind) {
    case "install":
      return new InstallError(message, options);
    case "network":
      return new NetworkError(message, options);
    case "state":
      return new StateError(message, options);
    default:
      return new InternalError(message, options);
  }
}

/**
 * Executa um processo com array de argumentos (nunca shell interpolation).
 */
export async function run(cmd: string[], options: RunOptions = {}): Promise<RunResult> {
  return await spawnAndCollect(cmd, options, "internal");
}

export async function runChecked(
  cmd: string[],
  options: RunOptions & { message: string; kind?: RunErrorKind },
): Promise<RunResult> {
  const result = await spawnAndCollect(cmd, options, options.kind ?? "internal");
  if (result.code !== 0) {
    const detail = (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-6).join("\n");
    throw errorFor(options.kind ?? "internal", options.message, {
      details: { command: cmd[0], exitCode: result.code, output: detail },
    });
  }
  return result;
}

async function spawnAndCollect(cmd: string[], options: RunOptions, kind: RunErrorKind): Promise<RunResult> {
  const spawnOptions: Bun.SpawnOptions.SpawnOptions<"ignore" | Uint8Array, "pipe", "pipe"> & { cmd: string[] } = {
    cmd,
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
    cwd: options.cwd,
    env: options.env === undefined ? undefined : { ...process.env, ...options.env },
  };

  let process_: Bun.Subprocess<"ignore" | Uint8Array, "pipe", "pipe">;
  try {
    process_ = Bun.spawn(spawnOptions);
  } catch (error) {
    throw errorFor(kind, `não foi possível executar "${cmd[0]}"`, {
      hint: "verifique se a ferramenta existe no PATH",
      cause: error,
    });
  }

  const timer =
    options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
          try {
            process_.kill(9);
          } catch {
            /* processo já terminou */
          }
        }, options.timeoutMs)
      : null;

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(process_.stdout).text(),
      new Response(process_.stderr).text(),
      process_.exited,
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    throw errorFor(kind, `falha ao executar "${cmd[0]}"`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Executa herdando stdio (sudo, prompts interativos). Retorna o código de saída. */
export async function runInteractive(cmd: string[]): Promise<number> {
  try {
    const process_ = Bun.spawn({ cmd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    return await process_.exited;
  } catch (error) {
    throw new InternalError(`não foi possível executar "${cmd[0]}"`, { cause: error });
  }
}

export function commandExists(name: string): string | null {
  return Bun.which(name) ?? null;
}

export function hasCommand(name: string): boolean {
  return commandExists(name) !== null;
}
