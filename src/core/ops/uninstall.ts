import { dirname } from "node:path";
import { AmbiguityError, InstallError, SecurityError, UsageError } from "../errors.ts";
import { isWritableDirectory, pathExists, removePath } from "../fsx.ts";
import { isAppBundle, isAppRunning, readAppBundle } from "../inspect/app-bundle.ts";
import { ui } from "../output.ts";
import { confirm } from "../prompts.ts";
import { run } from "../process.ts";
import { resolveItem, suggestItems } from "../registry/resolve.ts";
import type { ObservedApp, RegistryItem } from "../registry/schema.ts";
import { loadRegistry, removeItem, updateRegistry } from "../registry/store.ts";
import { canPrompt, type Ctx } from "./context.ts";

export interface UninstallOptions {
  keepFiles: boolean;
}

export interface UninstallResult {
  action: "uninstalled" | "forgotten" | "planned";
  item: { id: string; displayName: string; kind: string };
  removedPaths: string[];
  missingPaths: string[];
  keptFiles: boolean;
  forgottenReceipts: string[];
  receiptWarnings: string[];
  notes: string[];
}

export async function runUninstall(ctx: Ctx, query: string, options: UninstallOptions): Promise<UninstallResult> {
  const registry = await loadRegistry();
  const item = resolveItem(registry.items, query);
  if (item === null) {
    const suggestions = suggestItems(registry.items, query);
    throw new UsageError(`item não encontrado: ${query}`, {
      hint: suggestions.length > 0 ? `talvez você quis dizer: ${suggestions.join(", ")}` : "veja `dmngr list`",
    });
  }

  const targets = await collectRemovalTargets(item);
  const existingPaths: string[] = [];
  const missingPaths: string[] = [];
  for (const target of targets) {
    if (await pathExists(target.path)) existingPaths.push(target.path);
    else missingPaths.push(target.path);
  }

  if (!options.keepFiles) {
    for (const target of targets) {
      if (!(await pathExists(target.path))) continue;
      await assertSafeToDeleteApp(item, target);
    }
  }

  const planLines = buildPlanNotes(item, existingPaths, missingPaths, options.keepFiles);
  if (ctx.opts.dryRun) {
    for (const line of planLines) ui.info(line);
    return {
      action: "planned",
      item: { id: item.id, displayName: item.displayName, kind: item.kind },
      removedPaths: options.keepFiles ? [] : existingPaths,
      missingPaths,
      keptFiles: options.keepFiles,
      forgottenReceipts: item.kind === "pkg" ? item.receipts.map((receipt) => receipt.identifier) : [],
      receiptWarnings: [],
      notes: planLines,
    };
  }

  await requireUninstallConfirmation(ctx, item, existingPaths, missingPaths, options.keepFiles);

  const removedPaths: string[] = [];
  if (!options.keepFiles) {
    for (const path of existingPaths) {
      const parent = dirname(path);
      if (!(await isWritableDirectory(parent))) {
        throw new InstallError(`sem permissão de escrita para remover ${path}`, {
          hint: "ajuste as permissões do diretório ou remova o app manualmente e use --keep-files",
        });
      }
      try {
        await removePath(path);
      } catch (error) {
        throw new InstallError(`não foi possível remover ${path}`, {
          hint: "feche o app se estiver aberto e verifique permissões",
          cause: error,
        });
      }
      removedPaths.push(path);
      ui.info(`removido: ${path}`);
    }
  }

  const receiptWarnings: string[] = [];
  const forgottenReceipts: string[] = [];
  if (item.kind === "pkg" && item.receipts.length > 0 && !options.keepFiles) {
    for (const receipt of item.receipts) {
      const result = await run(["pkgutil", "--forget", receipt.identifier]);
      if (result.code === 0) {
        forgottenReceipts.push(receipt.identifier);
      } else {
        const detail = (result.stderr || result.stdout).trim() || `exit ${result.code}`;
        receiptWarnings.push(`${receipt.identifier}: ${detail}`);
      }
    }
    if (receiptWarnings.length > 0) {
      ui.warn(
        "alguns receipts de PKG não puderam ser esquecidos (pkgutil --forget pode exigir privilégios); arquivos fora dos .app observados podem permanecer",
      );
      for (const warning of receiptWarnings) ui.verbose(warning);
    }
  } else if (item.kind === "pkg" && !options.keepFiles) {
    ui.warn("desinstalação de PKG remove apenas os .app observados; scripts e outros arquivos do instalador podem permanecer");
  }

  await updateRegistry((reg) => {
    if (!removeItem(reg, item.id)) {
      throw new UsageError(`item desapareceu do registro durante a remoção: ${item.id}`);
    }
  });

  const action = options.keepFiles || removedPaths.length === 0 ? "forgotten" : "uninstalled";
  ui.info(
    action === "forgotten"
      ? `esquecido do registro: ${item.displayName} (${item.id})`
      : `desinstalado: ${item.displayName} (${item.id})`,
  );

  return {
    action,
    item: { id: item.id, displayName: item.displayName, kind: item.kind },
    removedPaths,
    missingPaths,
    keptFiles: options.keepFiles,
    forgottenReceipts,
    receiptWarnings,
    notes: planLines,
  };
}

interface RemovalTarget {
  path: string;
  observed: ObservedApp | null;
}

async function collectRemovalTargets(item: RegistryItem): Promise<RemovalTarget[]> {
  const targets: RemovalTarget[] = [];
  const seen = new Set<string>();
  const push = (path: string, observed: ObservedApp | null): void => {
    if (seen.has(path)) return;
    seen.add(path);
    targets.push({ path, observed });
  };

  if (item.installedPath !== null) {
    push(item.installedPath, null);
  }
  for (const observed of item.observedApps) {
    push(observed.path, observed);
  }
  return targets;
}

async function assertSafeToDeleteApp(item: RegistryItem, target: RemovalTarget): Promise<void> {
  const { path } = target;
  if (!(await isAppBundle(path))) {
    throw new InstallError(`${path} não é um bundle .app removível pelo dmngr`, {
      hint: "use --keep-files para apenas tirar o item do registro, ou remova o caminho manualmente",
    });
  }
  const bundle = await readAppBundle(path);
  const expectedBundleId = target.observed?.bundleId ?? item.bundleId;
  if (expectedBundleId !== null && bundle.bundleId !== null && bundle.bundleId !== expectedBundleId) {
    throw new SecurityError(
      `o app em ${path} mudou de identidade (esperado ${expectedBundleId}, encontrado ${bundle.bundleId})`,
      {
        hint: "nada foi removido; confirme o caminho ou use --keep-files para só esquecer o registro",
        details: { path, expected: expectedBundleId, actual: bundle.bundleId },
      },
    );
  }
  if (await isAppRunning(path, bundle.executable)) {
    throw new InstallError(`${bundle.name ?? item.displayName} está em execução`, {
      hint: "feche o app e rode o comando novamente",
      details: { path },
    });
  }
}

function buildPlanNotes(
  item: RegistryItem,
  existingPaths: string[],
  missingPaths: string[],
  keepFiles: boolean,
): string[] {
  const notes: string[] = [`item: ${item.displayName} (${item.id})`];
  if (keepFiles) {
    notes.push("modo: apenas remover do registro (--keep-files); arquivos no disco permanecem");
  } else if (existingPaths.length > 0) {
    notes.push(`remover do disco: ${existingPaths.join(", ")}`);
  } else {
    notes.push("nenhum caminho presente no disco; apenas o registro será limpo");
  }
  if (missingPaths.length > 0) {
    notes.push(`já ausente: ${missingPaths.join(", ")}`);
  }
  if (item.kind === "pkg" && !keepFiles) {
    notes.push("PKG: receipts serão esquecidos com pkgutil --forget quando possível");
  }
  return notes;
}

async function requireUninstallConfirmation(
  ctx: Ctx,
  item: RegistryItem,
  existingPaths: string[],
  missingPaths: string[],
  keepFiles: boolean,
): Promise<void> {
  if (ctx.opts.yes) return;
  const diskPart = keepFiles
    ? "apenas do registro (arquivos permanecem)"
    : existingPaths.length > 0
      ? `de ${existingPaths.join(", ")} e do registro`
      : missingPaths.length > 0
        ? "do registro (já ausente no disco)"
        : "do registro";
  const message = `remover ${item.displayName} (${item.id}) ${diskPart}?`;
  if (!canPrompt(ctx)) {
    throw new AmbiguityError(message, {
      hint: "confirme em um terminal interativo ou passe --yes",
    });
  }
  const ok = await confirm(message);
  if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");
}

export function uninstallResultToJson(result: UninstallResult): Record<string, unknown> {
  return {
    schemaVersion: 1,
    command: "uninstall",
    action: result.action,
    item: result.item,
    removedPaths: result.removedPaths,
    missingPaths: result.missingPaths,
    keptFiles: result.keptFiles,
    forgottenReceipts: result.forgottenReceipts,
    receiptWarnings: result.receiptWarnings,
    notes: result.notes,
  };
}

export function renderUninstallResult(result: UninstallResult): void {
  const lines = [
    result.action === "planned" ? "plano de desinstalação" : result.action === "forgotten" ? "esquecido" : "desinstalado",
    `  item: ${result.item.displayName} (${result.item.id})`,
  ];
  if (result.removedPaths.length > 0) {
    lines.push(`  removido: ${result.removedPaths.join(", ")}`);
  }
  if (result.missingPaths.length > 0) {
    lines.push(`  já ausente: ${result.missingPaths.join(", ")}`);
  }
  if (result.keptFiles) lines.push("  arquivos: preservados (--keep-files)");
  if (result.forgottenReceipts.length > 0) {
    lines.push(`  receipts: ${result.forgottenReceipts.join(", ")}`);
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
