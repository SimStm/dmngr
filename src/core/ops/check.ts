import { pathExists } from "../fsx.ts";
import { AmbiguityError, UsageError, toDmngrError } from "../errors.ts";
import { probeUrl } from "../input/download.ts";
import { selectReleaseAsset, type ReleaseChannel } from "../providers/github.ts";
import { ui } from "../output.ts";
import { resolveItem, suggestItems } from "../registry/resolve.ts";
import type { RegistryItem } from "../registry/schema.ts";
import { loadRegistry } from "../registry/store.ts";
import { canPrompt, networkPolicy, type Ctx } from "./context.ts";
import { decideGithubCheck, decideHttpCheck, untrackableOutcome, type CheckOutcome, type CheckStatus } from "./decide.ts";
import { archsOf } from "./item.ts";
import { machineArch } from "../system.ts";
import { readLiveItemInfo, refreshItemInMemory } from "./live.ts";

export interface CheckRow {
  id: string;
  displayName: string;
  kind: string;
  status: CheckStatus;
  reason: string;
  evidence: string;
  installedVersion: string | null;
  localVersion: string | null;
  availableVersion: string | null;
  releaseTag: string | null;
  drift: boolean;
  missingLocal: boolean;
  hint?: string;
  candidates?: string[];
}

export async function runCheck(ctx: Ctx, query: string | undefined): Promise<{ rows: CheckRow[]; refreshed: number }> {
  const registry = await loadRegistry();
  let items: RegistryItem[];
  if (query === undefined) {
    items = registry.items;
  } else {
    const item = resolveItem(registry.items, query);
    if (item === null) {
      const suggestions = suggestItems(registry.items, query);
      throw new UsageError(`item não encontrado: ${query}`, {
        hint: suggestions.length > 0 ? `talvez você quis dizer: ${suggestions.join(", ")}` : "veja `dmngr list`",
      });
    }
    items = [item];
  }

  const rows: CheckRow[] = [];
  let refreshed = 0;
  const updates: RegistryItem[] = [];
  const checkedAt = new Date().toISOString();

  for (const item of items) {
    const live = await readLiveItemInfo(item);
    const { item: current, changed } = await refreshItemInMemory(item, live);
    if (changed) {
      refreshed += 1;
      ui.verbose(`${item.id}: versão local relida do disco (${live.installedVersion ?? "desconhecida"})`);
    }
    const row = await checkOne(ctx, current, live.installedVersion, !live.installedExists);
    rows.push(row);
    updates.push({ ...current, lastCheckedAt: checkedAt, lastCheckStatus: row.status });
  }

  if (!ctx.opts.dryRun) {
    const { updateRegistry, upsertItem } = await import("../registry/store.ts");
    await updateRegistry((registryToUpdate) => {
      for (const item of updates) upsertItem(registryToUpdate, item);
    });
  }

  return { rows, refreshed };
}

export async function checkOne(
  ctx: Ctx,
  item: RegistryItem,
  localVersion: string | null,
  missingLocal: boolean,
): Promise<CheckRow> {
  const base = {
    id: item.id,
    displayName: item.displayName,
    kind: item.kind,
    installedVersion: item.installedVersion,
    localVersion,
    drift: localVersion !== item.installedVersion,
    missingLocal,
  };

  let outcome: CheckOutcome;
  try {
    outcome = await computeOutcome(ctx, item);
  } catch (error) {
    const dmngrError = toDmngrError(error);
    const status = (dmngrError.details as { status?: number } | undefined)?.status;
    outcome = {
      status: dmngrError.kind === "network" && status === 404 ? "not_found" : "error",
      reason: dmngrError.kind === "network" ? (status === 404 ? "remote-404" : "network-error") : dmngrError.kind,
      evidence: "none",
      installedVersion: item.installedVersion,
      availableVersion: null,
      releaseTag: null,
      hint: dmngrError.hint ?? dmngrError.message,
    };
  }

  return {
    ...base,
    status: outcome.status,
    reason: outcome.reason,
    evidence: outcome.evidence,
    availableVersion: outcome.availableVersion,
    releaseTag: outcome.releaseTag,
    hint: outcome.hint,
    candidates: outcome.candidates,
  };
}

async function computeOutcome(ctx: Ctx, item: RegistryItem): Promise<CheckOutcome> {
  const source = item.source;
  if (source.kind === "github-release" && source.repository !== null) {
    const [owner, repo] = source.repository.split("/");
    if (owner === undefined || repo === undefined) {
      return { ...untrackableOutcome(item), hint: `repositório inválido no registro: ${source.repository}` };
    }
    const channel: ReleaseChannel = ctx.opts.prerelease ? "prerelease" : source.channel === "prerelease" ? "prerelease" : "stable";
    const release = await ctx.github.releaseForChannel(owner, repo, channel);
    const selection = selectReleaseAsset(release, {
      savedPattern: source.assetPattern,
      machineArch: machineArch(),
      preferredArchs: archsOf(item),
    });
    return decideGithubCheck(item, release, selection);
  }
  if (source.kind === "direct-url" && source.resolvedUrl !== null) {
    const probe = await probeUrl({ url: source.resolvedUrl, policy: networkPolicy(ctx) });
    return decideHttpCheck(item, probe);
  }
  return untrackableOutcome(item);
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export interface UpdateAllRow {
  id: string;
  displayName: string;
  result: "updated" | "failed" | "skipped" | "noop";
  note: string;
}

export interface UpdateAllReport {
  rows: UpdateAllRow[];
  updated: number;
  failed: number;
  skipped: number;
}

export interface UpdateAllOptions {
  apply: (item: RegistryItem) => Promise<{ action: string; version: string | null }>;
}

/**
 * Atualiza somente itens cuja origem forneça artefato inequívoco e versão verificável,
 * com uma única confirmação agregada.
 */
export async function runUpdateAll(ctx: Ctx, options: UpdateAllOptions): Promise<UpdateAllReport> {
  const registry = await loadRegistry();
  if (registry.items.length === 0) {
    return { rows: [], updated: 0, failed: 0, skipped: 0 };
  }

  const candidates: { item: RegistryItem; row: CheckRow }[] = [];
  const rows: UpdateAllRow[] = [];

  for (const item of registry.items) {
    const live = await readLiveItemInfo(item);
    const { item: current } = await refreshItemInMemory(item, live);
    const row = await checkOne(ctx, current, live.installedVersion, !live.installedExists);
    if (row.status === "update_available") {
      candidates.push({ item: current, row });
    } else {
      rows.push({
        id: item.id,
        displayName: item.displayName,
        result: row.status === "up_to_date" ? "noop" : "skipped",
        note: `${row.status}: ${row.reason}`,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      rows,
      updated: 0,
      failed: 0,
      skipped: rows.filter((row) => row.result === "skipped").length,
    };
  }

  ui.info(`${candidates.length} item(ns) com atualização disponível:`);
  for (const candidate of candidates) {
    const version = candidate.row.availableVersion ?? "?";
    ui.info(`  ${candidate.item.id}: ${candidate.item.installedVersion ?? "?"} → ${version} (${candidate.row.evidence})`);
  }

  if (!canPrompt(ctx)) {
    throw new AmbiguityError("confirmação agregada necessária para --all", {
      hint: "rode em terminal interativo ou atualize item por item",
      details: { candidates: candidates.map((candidate) => candidate.item.id) },
    });
  }
  const { confirm } = await import("../prompts.ts");
  const ok = await confirm(`Atualizar ${candidates.length} item(ns) agora?`);
  if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");

  let updated = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await options.apply(candidate.item);
      updated += 1;
      rows.push({
        id: candidate.item.id,
        displayName: candidate.item.displayName,
        result: result.action === "noop" ? "noop" : "updated",
        note: `versão ${result.version ?? "desconhecida"}`,
      });
    } catch (error) {
      const dmngrError = toDmngrError(error);
      failed += 1;
      rows.push({
        id: candidate.item.id,
        displayName: candidate.item.displayName,
        result: "failed",
        note: dmngrError.message,
      });
      ui.error(`${candidate.item.id}: ${dmngrError.message}`);
    }
  }
  return { rows, updated, failed, skipped: rows.filter((row) => row.result === "skipped").length };
}

export async function isLocalArtifactTarget(target: string): Promise<boolean> {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(target)) return true;
  if (target.startsWith("/") || target.startsWith("./") || target.startsWith("../") || target.startsWith("~")) return true;
  return await pathExists(target);
}


