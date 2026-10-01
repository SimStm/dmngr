import { rename } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { InstallError } from "../errors.ts";
import { ensureDir, listDir, pathExists, randomSuffix, removePath } from "../fsx.ts";
import { ui } from "../output.ts";
import { runChecked } from "../process.ts";

export interface InstallAppOptions {
  /** Bundle .app já disponível (ex.: dentro do DMG montado). */
  source: string;
  destinationDir: string;
  targetName?: string;
  /** Executado após a cópia para staging e antes de tocar no destino. */
  beforeCommit?: (stagedApp: string) => Promise<void>;
}

export interface InstallAppResult {
  installedPath: string;
  hadPrevious: boolean;
}

/**
 * Instala um bundle .app de forma transacional o quanto possível:
 *   ditto → staging no mesmo filesystem → verificação → backup do antigo → rename.
 * Em falha antes do commit o app anterior é restaurado; se a restauração falhar,
 * os artefatos são preservados e os caminhos são informados no erro.
 */
export async function installAppBundle(options: InstallAppOptions): Promise<InstallAppResult> {
  const name = options.targetName ?? basename(options.source);
  if (!name.endsWith(".app")) {
    throw new InstallError(`esperado um bundle .app, recebido: ${name}`);
  }

  const target = join(options.destinationDir, name);
  const stagingRoot = join(options.destinationDir, `.dmngr-staging-${randomSuffix()}`);
  const backupRoot = join(options.destinationDir, `.dmngr-backup-${randomSuffix()}`);
  const stagedApp = join(stagingRoot, name);
  const backupTarget = join(backupRoot, name);

  try {
    await ensureDir(stagingRoot, 0o755);
  } catch (error) {
    throw new InstallError(`não foi possível escrever em ${options.destinationDir}`, {
      hint: "escolha outro destino com --destination",
      cause: error,
    });
  }

  let preserveStaging = false;

  try {
    await runChecked(["ditto", options.source, stagedApp], {
      message: `falha ao copiar ${basename(options.source)}`,
      kind: "install",
    });

    if (options.beforeCommit !== undefined) await options.beforeCommit(stagedApp);

    const hadPrevious = await pathExists(target);
    if (hadPrevious) {
      await ensureDir(backupRoot, 0o755);
      try {
        await rename(target, backupTarget);
      } catch (error) {
        throw new InstallError(`não foi possível mover o app existente para backup: ${target}`, {
          hint: "verifique se o app está em execução e se há permissão de escrita",
          cause: error,
        });
      }
    }

    try {
      await rename(stagedApp, target);
    } catch (error) {
      if (hadPrevious) {
        try {
          await rename(backupTarget, target);
        } catch (restoreError) {
          preserveStaging = true;
          throw new InstallError("a troca do app falhou e o app anterior não pôde ser restaurado automaticamente", {
            hint: `app anterior preservado em ${backupTarget}; novo app em ${stagedApp}`,
            details: { backupPath: backupTarget, stagedPath: stagedApp, restoreError: String(restoreError) },
            cause: error,
          });
        }
      }
      throw new InstallError(`não foi possível instalar em ${target}`, { cause: error });
    }

    if (hadPrevious) {
      await removePath(backupRoot).catch(() => {
        ui.verbose(`backup preservado em ${backupRoot}`);
      });
    }

    return { installedPath: target, hadPrevious };
  } finally {
    if (!preserveStaging) {
      await removePath(stagingRoot).catch(() => {
        ui.verbose(`staging preservado em ${stagingRoot}`);
      });
    }
  }
}

/** Nome único para "manter ambos" (Foo.app → Foo 2.app). */
export async function uniqueAppName(destinationDir: string, name: string): Promise<string> {
  const extension = extname(name);
  const base = name.slice(0, name.length - extension.length);
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base} ${index}${extension}`;
    if (!(await pathExists(join(destinationDir, candidate)))) return candidate;
  }
  throw new InstallError(`não foi possível gerar um nome único para ${name}`);
}

/** Artefatos de staging/backup deixados por operações interrompidas (usado no doctor). */
export async function stagingArtifacts(dir: string): Promise<string[]> {
  const entries = await listDir(dir);
  return entries.filter((entry) => entry.startsWith(".dmngr-")).map((entry) => join(dir, entry));
}
