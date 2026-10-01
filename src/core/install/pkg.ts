import { InstallError } from "../errors.ts";
import { isAppBundle, readAppBundle } from "../inspect/app-bundle.ts";
import { payloadAppPaths, type PkgInfo } from "../inspect/pkg.ts";
import { ui } from "../output.ts";
import { pathExists } from "../fsx.ts";
import { run, runChecked, runInteractive } from "../process.ts";
import type { ObservedApp } from "../registry/schema.ts";

export type ElevateMode = "osascript" | "sudo" | "none";

const INSTALLER = "/usr/sbin/installer";

export interface InstallPkgOptions {
  pkgPath: string;
  elevate: ElevateMode;
  interactive: boolean;
}

export interface InstallPkgResult {
  method: "root" | "osascript" | "sudo";
}

/**
 * Instala o pacote elevando privilégio apenas nesta etapa.
 * O dmngr em si continua rodando como o usuário, preservando o registro por usuário.
 */
export async function installPkg(options: InstallPkgOptions): Promise<InstallPkgResult> {
  if (process.getuid?.() === 0) {
    await runChecked([INSTALLER, "-pkg", options.pkgPath, "-target", "/"], {
      message: "a instalação do pacote falhou",
      kind: "install",
      timeoutMs: 0,
    });
    return { method: "root" };
  }

  const manualCommand = `sudo installer -pkg '${options.pkgPath}' -target /`;

  if (options.elevate === "none") {
    throw new InstallError("instalar este pacote exige privilégio de administrador", {
      hint: `rode manualmente e depois registre: ${manualCommand}`,
      details: { command: manualCommand },
    });
  }

  if (options.elevate === "osascript") {
    const lines = [
      "on run argv",
      'do shell script "/usr/sbin/installer -pkg " & quoted form of item 1 of argv & " -target /" with administrator privileges',
      "end run",
    ];
    const result = await run(["osascript", "-e", lines[0] ?? "", "-e", lines[1] ?? "", "-e", lines[2] ?? "", "--", options.pkgPath], {
      timeoutMs: 0,
    });
    if (result.code === 0) return { method: "osascript" };

    if (options.interactive && Boolean(process.stdin.isTTY)) {
      ui.warn("o pedido de autorização via diálogo falhou; tentando sudo no terminal");
      const code = await runInteractive(["/usr/bin/sudo", INSTALLER, "-pkg", options.pkgPath, "-target", "/"]);
      if (code === 0) return { method: "sudo" };
      throw new InstallError("a instalação do pacote falhou", { details: { exitCode: code } });
    }

    throw new InstallError("a instalação do pacote foi cancelada ou falhou", {
      hint: "em terminal sem interface gráfica use --elevate sudo",
      details: { output: tail(result.stderr || result.stdout) },
    });
  }

  const code = await runInteractive(["/usr/bin/sudo", INSTALLER, "-pkg", options.pkgPath, "-target", "/"]);
  if (code !== 0) {
    throw new InstallError("a instalação do pacote falhou", { details: { exitCode: code } });
  }
  return { method: "sudo" };
}

/**
 * Apps observados após a instalação: lê os bundles declarados no payload
 * (caminho do install-location + path do bundle) e confirma os que existem.
 */
export async function observedAppsFromPayload(info: PkgInfo): Promise<ObservedApp[]> {
  const declared = payloadAppPaths(info);
  const observed: ObservedApp[] = [];
  for (const entry of declared) {
    if (!(await pathExists(entry.path))) continue;
    if (await isAppBundle(entry.path)) {
      try {
        const bundle = await readAppBundle(entry.path);
        observed.push({ path: entry.path, bundleId: bundle.bundleId, version: bundle.shortVersion });
        continue;
      } catch {
        /* segue com a versão declarada */
      }
    }
    observed.push({ path: entry.path, bundleId: entry.bundleId, version: entry.declaredVersion });
  }
  if (observed.length === 0) {
    for (const entry of declared) {
      observed.push({ path: entry.path, bundleId: entry.bundleId, version: entry.declaredVersion });
    }
  }
  return observed;
}

function tail(text: string): string {
  return text.trim().split("\n").slice(-6).join("\n");
}
