import { classifyInput, type ParsedInput } from "../input/resolve.ts";
import { UsageError } from "../errors.ts";
import { ui } from "../output.ts";
import { confirm } from "../prompts.ts";
import { resolveItem, suggestItems } from "../registry/resolve.ts";
import type { RegistryItem } from "../registry/schema.ts";
import { loadRegistry } from "../registry/store.ts";
import { canPrompt, type Ctx } from "./context.ts";
import { machineArch } from "../system.ts";
import type { ReleaseChannel } from "../providers/github.ts";
import { isLocalArtifactTarget, runUpdateAll, type UpdateAllReport } from "./check.ts";
import {
  chooseAssetInteractively,
  chooseChannelInteractively,
  fetchAndApply,
  handleArchConcern,
  type OperationReport,
} from "./install.ts";
import { archsOf } from "./item.ts";
import { resolveSourceForInput, resolveSourceForUpdate, type ResolvedSource } from "./source.ts";

export type UpdateOutcome = { kind: "report"; report: OperationReport } | { kind: "all"; report: UpdateAllReport };

export interface UpdateOptions {
  url?: string;
  all?: boolean;
  app?: string;
}

export async function runUpdate(ctx: Ctx, target: string | undefined, options: UpdateOptions): Promise<UpdateOutcome> {
  if (options.all === true) {
    if (target !== undefined) throw new UsageError("--all não aceita um item específico");
    const report = await runUpdateAll(ctx, {
      apply: async (item) => {
        const result = await updateItem(ctx, item, undefined);
        return { action: result.action, version: result.installedVersion };
      },
    });
    return { kind: "all", report };
  }

  if (target === undefined) {
    throw new UsageError("informe um item, uma URL/arquivo ou use --all");
  }

  if (await isLocalArtifactTarget(target)) {
    return { kind: "report", report: await updateFromArtifact(ctx, target, options.app) };
  }

  const item = await requireItem(target);
  return { kind: "report", report: await updateItem(ctx, item, options.url) };
}

async function requireItem(query: string): Promise<RegistryItem> {
  const registry = await loadRegistry();
  const item = resolveItem(registry.items, query);
  if (item === null) {
    const suggestions = suggestItems(registry.items, query);
    throw new UsageError(`item não encontrado: ${query}`, {
      hint: suggestions.length > 0 ? `talvez você quis dizer: ${suggestions.join(", ")}` : "veja `dmngr list`",
    });
  }
  return item;
}

async function updateItem(ctx: Ctx, item: RegistryItem, urlOverride: string | undefined): Promise<OperationReport> {
  let resolved: ResolvedSource;
  let parsedInput: ParsedInput;

  const machine = machineArch();
  const channel: ReleaseChannel = ctx.opts.prerelease
    ? "prerelease"
    : item.source.channel === "prerelease"
      ? "prerelease"
      : "stable";

  if (urlOverride !== undefined) {
    parsedInput = await classifyInput(urlOverride);
    resolved = await resolveSourceForInput(ctx, parsedInput, {
      savedPattern: item.source.assetPattern,
      archs: archsOf(item),
      machineArch: machine,
      channel,
      pin: ctx.opts.pin,
      latest: ctx.opts.latest,
      chooseAsset: (candidates) => chooseAssetInteractively(ctx, candidates),
      chooseChannel: (info) => chooseChannelInteractively(ctx, info),
    });
    if (item.source.kind !== "unknown") {
      ui.info("a origem registrada será substituída pela nova URL após o sucesso");
    }
  } else {
    if (ctx.opts.pin) {
      throw new UsageError("--pin exige uma URL explícita", {
        hint: `use \`dmngr update ${item.id} --url <url> --pin\` ou --latest para sair de uma versão fixada`,
      });
    }
    resolved = await resolveSourceForUpdate(ctx, item, {
      channel,
      latest: ctx.opts.latest,
      machineArch: machine,
      chooseAsset: (candidates) => chooseAssetInteractively(ctx, candidates),
      chooseChannel: (info) => chooseChannelInteractively(ctx, info),
    });
    parsedInput = {
      kind: "url",
      raw: item.source.inputUrl ?? item.id,
      displayUrl: item.source.inputUrl ?? item.id,
      url: resolved.downloadUrl,
      filePath: null,
      github: null,
    };
  }

  const archConcern = await handleArchConcern(ctx, resolved);
  return await fetchAndApply(ctx, "update", parsedInput, resolved, item, "install", archConcern);
}

async function updateFromArtifact(ctx: Ctx, target: string, appId: string | undefined): Promise<OperationReport> {
  let existing: RegistryItem | null = null;
  if (appId !== undefined) {
    existing = await requireItem(appId);
  } else if (canPrompt(ctx)) {
    ui.verbose("nenhum --app informado: o item será associado pela identidade do artefato");
  }

  const input = await classifyInput(target);
  const channel: ReleaseChannel = ctx.opts.prerelease
    ? "prerelease"
    : existing !== null && existing.source.channel === "prerelease"
      ? "prerelease"
      : "stable";
  const resolved = await resolveSourceForInput(ctx, input, {
    savedPattern: existing?.source.assetPattern ?? null,
    archs: existing !== null ? archsOf(existing) : null,
    machineArch: machineArch(),
    channel,
    pin: ctx.opts.pin,
    latest: ctx.opts.latest,
    chooseAsset: (candidates) => chooseAssetInteractively(ctx, candidates),
    chooseChannel: (info) => chooseChannelInteractively(ctx, info),
  });

  const archConcern = await handleArchConcern(ctx, resolved);
  return await fetchAndApply(
    ctx,
    "update",
    input,
    resolved,
    existing,
    appId !== undefined ? "install" : "require-existing",
    archConcern,
  );
}

export async function confirmOriginReplacement(ctx: Ctx, item: RegistryItem): Promise<boolean> {
  if (!canPrompt(ctx)) return true;
  return await confirm(`Substituir a origem registrada de ${item.id} pela nova URL?`, { defaultYes: true });
}
