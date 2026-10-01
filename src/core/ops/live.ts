import { pathExists } from "../fsx.ts";
import { isAppBundle, readAppBundle } from "../inspect/app-bundle.ts";
import { readReceipts } from "../inspect/pkg.ts";
import type { RegistryItem } from "../registry/schema.ts";

export interface LiveItemInfo {
  installedExists: boolean;
  installedVersion: string | null;
  buildVersion: string | null;
  bundleId: string | null;
  arch: string | null;
  notes: string[];
}

/** Relê a versão local do disco — auto-updaters internos alteram a versão sem passar pelo dmngr. */
export async function readLiveItemInfo(item: RegistryItem): Promise<LiveItemInfo> {
  const notes: string[] = [];
  if (item.installedPath === null) {
    return { installedExists: false, installedVersion: null, buildVersion: null, bundleId: null, arch: null, notes: ["item sem caminho instalado registrado"] };
  }
  if (!(await pathExists(item.installedPath))) {
    return {
      installedExists: false,
      installedVersion: null,
      buildVersion: null,
      bundleId: null,
      arch: null,
      notes: [`não existe mais em ${item.installedPath}`],
    };
  }

  if (item.kind === "app") {
    if (!(await isAppBundle(item.installedPath))) {
      return {
        installedExists: true,
        installedVersion: null,
        buildVersion: null,
        bundleId: null,
        arch: null,
        notes: [`${item.installedPath} não é mais um bundle .app`],
      };
    }
    const bundle = await readAppBundle(item.installedPath);
    if (item.bundleId !== null && bundle.bundleId !== null && bundle.bundleId !== item.bundleId) {
      notes.push(`o bundle id mudou de ${item.bundleId} para ${bundle.bundleId}`);
    }
    return {
      installedExists: true,
      installedVersion: bundle.shortVersion,
      buildVersion: bundle.buildVersion,
      bundleId: bundle.bundleId,
      arch: bundle.archs?.join(" ") ?? null,
      notes,
    };
  }

  const identifiers = item.receipts.length > 0 ? item.receipts.map((receipt) => receipt.identifier) : [item.id];
  const receipts = await readReceipts(identifiers);
  const installedReceipts = receipts.filter((receipt) => receipt.installed);
  if (installedReceipts.length === 0) {
    notes.push("nenhum receipt encontrado (o pacote pode ter sido removido pelo próprio instalador)");
  }
  const withVersion = installedReceipts.find((receipt) => receipt.version !== null) ?? null;
  return {
    installedExists: installedReceipts.length > 0,
    installedVersion: withVersion?.version ?? null,
    buildVersion: null,
    bundleId: item.bundleId,
    arch: null,
    notes,
  };
}

/** Atualiza em memória a versão instalada relida do disco. */
export async function refreshItemInMemory(item: RegistryItem, live: LiveItemInfo): Promise<{ item: RegistryItem; changed: boolean }> {
  if (live.installedVersion === item.installedVersion && live.arch === item.arch && live.bundleId === item.bundleId) {
    return { item, changed: false };
  }
  return {
    item: {
      ...item,
      installedVersion: live.installedVersion ?? item.installedVersion,
      buildVersion: live.buildVersion ?? item.buildVersion,
      arch: live.arch ?? item.arch,
      lastResult: "version-refreshed",
      updatedAt: new Date().toISOString(),
    },
    changed: true,
  };
}
