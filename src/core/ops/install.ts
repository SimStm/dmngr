import { basename, join } from "node:path";
import { registerCleanup } from "../cleanup.ts";
import { AmbiguityError, InstallError, SecurityError, UsageError } from "../errors.ts";
import { fileSize, removePath, sha256File } from "../fsx.ts";
import { downloadToFile, formatBytes } from "../input/download.ts";
import { classifyInput, type ParsedInput } from "../input/resolve.ts";
import { ui } from "../output.ts";
import { chooseOne } from "../prompts.ts";
import type { GithubAsset, ReleaseChannel } from "../providers/github.ts";
import type { RegistryItem, SourceInfo } from "../registry/schema.ts";
import { createTempDir } from "../paths.ts";
import { canPrompt, keepDownloads, maxDownloadBytes, networkPolicy, type Ctx } from "./context.ts";
import { requireArchAcceptance, type RiskContext } from "./risk.ts";
import { applyArtifact, type ApplyAction, type ApplyResult } from "./apply.ts";
import {
  channelDecisionHint,
  channelDecisionMessage,
  resolveSourceForInput,
  type ChannelDecisionInfo,
  type ResolvedSource,
} from "./source.ts";
import { describeAssetArch, humanArch, machineArch, rosettaAvailable } from "../system.ts";

export interface OperationReport {
  command: "install" | "update";
  action: ApplyAction;
  itemId: string | null;
  displayName: string | null;
  installedPath: string | null;
  installedVersion: string | null;
  previousVersion: string | null;
  source: {
    kind: string;
    repository: string | null;
    url: string | null;
    tag: string | null;
    asset: string | null;
    channel: ReleaseChannel;
    pinnedTag: string | null;
  };
  artifact: { fileName: string; size: number | null; sha256: string | null };
  warnings: string[];
  notes: string[];
  dryRun: boolean;
}

export async function runInstall(ctx: Ctx, rawInput: string): Promise<OperationReport> {
  const input = await classifyInput(rawInput);
  const resolved = await resolveSourceForInput(ctx, input, {
    machineArch: machineArch(),
    channel: ctx.opts.prerelease ? "prerelease" : "stable",
    pin: ctx.opts.pin,
    latest: ctx.opts.latest,
    chooseAsset: (candidates) => chooseAssetInteractively(ctx, candidates),
    chooseChannel: (info) => chooseChannelInteractively(ctx, info),
  });
  const archConcern = await handleArchConcern(ctx, resolved);
  return await fetchAndApply(ctx, "install", input, resolved, null, "identify", archConcern);
}

export async function chooseAssetInteractively(ctx: Ctx, candidates: GithubAsset[]): Promise<GithubAsset> {
  const only = candidates[0];
  if (candidates.length === 1 && only !== undefined) return only;
  if (!canPrompt(ctx)) {
    throw new AmbiguityError("a release tem mais de um asset compatível", {
      hint: "escolha interativamente ou informe a URL do asset específico",
      details: { candidates: candidates.map((asset) => asset.name) },
    });
  }
  const choice = await chooseOne(
    "Qual asset usar?",
    candidates.map((asset, index) => ({
      value: String(index),
      label: asset.name,
      description: asset.size === null ? undefined : formatBytes(asset.size),
    })),
  );
  const chosen = candidates[Number.parseInt(choice, 10)];
  if (chosen === undefined) throw new AmbiguityError("escolha de asset inválida");
  return chosen;
}

export async function chooseChannelInteractively(ctx: Ctx, info: ChannelDecisionInfo): Promise<"pinned" | "channel"> {
  if (!canPrompt(ctx)) {
    throw new AmbiguityError(channelDecisionMessage(info), {
      hint: channelDecisionHint(),
      details: {
        repository: `${info.owner}/${info.repo}`,
        channel: info.channel,
        pinnedTag: info.pinnedTag,
        headTag: info.headTag,
      },
    });
  }
  const choice = await chooseOne(`${channelDecisionMessage(info)}. O que instalar?`, [
    {
      value: "channel",
      label: `a mais recente do canal (${info.headTag})`,
      description: "passa a seguir o canal em atualizações futuras",
    },
    {
      value: "pinned",
      label: `a versão da URL (${info.pinnedTag})`,
      description: "mantém o item fixado nessa versão (use --latest depois para sair)",
    },
    { value: "cancel", label: "cancelar" },
  ]);
  if (choice === "cancel") throw new AmbiguityError("operação cancelada pelo usuário");
  return choice;
}

export interface ArchConcernOutcome {
  acceptedMismatch: boolean;
  overrides: string[];
}

/**
 * Validação de arquitetura antes do download, a partir do nome do asset.
 * `needs-rosetta` exige aceite explícito; `unknown` é confirmado depois do download (lipo).
 */
export async function handleArchConcern(ctx: Ctx, resolved: ResolvedSource): Promise<ArchConcernOutcome> {
  const concern = resolved.archConcern;
  if (concern === null) return { acceptedMismatch: false, overrides: [] };

  const machine = machineArch();
  if (concern.kind === "unknown") {
    ui.verbose(`arquitetura de ${concern.assetName} não identificada pelo nome; será confirmada depois do download`);
    return { acceptedMismatch: false, overrides: [] };
  }

  const rosetta = await rosettaAvailable();
  if (!rosetta) {
    throw new InstallError(
      `${concern.assetName} é ${describeAssetArch(concern.assetArch)} e esta máquina é ${humanArch(machine)}; o Rosetta 2 não está disponível`,
      { hint: "instale com `softwareupdate --install-rosetta` ou escolha um build nativo para esta máquina" },
    );
  }
  const message = `${concern.assetName} é ${describeAssetArch(concern.assetArch)} e esta máquina é ${humanArch(machine)}: o app vai rodar via Rosetta 2`;
  const risk: RiskContext = { ctx, overrides: [], notes: resolved.notes, warnings: [] };
  await requireArchAcceptance(risk, message);
  const accepted = risk.overrides.includes("arch-mismatch");
  return { acceptedMismatch: accepted, overrides: risk.overrides };
}

export async function fetchAndApply(
  ctx: Ctx,
  command: "install" | "update",
  input: ParsedInput,
  resolved: ResolvedSource,
  existingItem: RegistryItem | null,
  mode: "install" | "identify" | "require-existing",
  archConcern: ArchConcernOutcome = { acceptedMismatch: false, overrides: [] },
): Promise<OperationReport> {
  const fileName = resolved.fileNameHint ?? (input.filePath === null ? "artefato" : basename(input.filePath));

  if (ctx.opts.dryRun && input.filePath === null) {
    return planReport(command, resolved, fileName, existingItem);
  }

  let localPath: string;
  let downloadedDir: string | null = null;
  let unregisterCleanup: (() => void) | null = null;
  let size: number;
  let sha256: string;
  let source = resolved.source;

  if (
    !ctx.opts.reinstall &&
    existingItem !== null &&
    resolved.expectedSha256 !== null &&
    existingItem.artifact.sha256 !== null &&
    existingItem.artifact.sha256 === resolved.expectedSha256
  ) {
    ui.info("o artefato remoto é idêntico ao instalado (digest da release); não é preciso baixar");
    return buildReport(
      command,
      {
        action: "noop",
        item: existingItem,
        installedPath: existingItem.installedPath,
        installedVersion: existingItem.installedVersion,
        previousVersion: null,
        warnings: [],
        notes: ["sha256 do asset remoto confere com o artefato instalado; download evitado"],
      },
      resolved,
      fileName,
      resolved.expectedSize ?? existingItem.artifact.size ?? 0,
      resolved.expectedSha256,
      ctx.opts.dryRun,
    );
  }

  try {
    if (input.filePath !== null) {
      localPath = input.filePath;
      size = await fileSize(localPath);
      sha256 = await sha256File(localPath);
      if (ctx.opts.sha256 != null && ctx.opts.sha256.toLowerCase() !== sha256) {
        throw new SecurityError("o hash SHA-256 do arquivo local não confere com --sha256", {
          details: { expected: ctx.opts.sha256.toLowerCase(), actual: sha256 },
        });
      }
      ui.info(`arquivo local: ${localPath} (${formatBytes(size)})`);
    } else {
      if (resolved.downloadUrl === null) {
        throw new UsageError("não há URL para baixar");
      }
      const dir = await createTempDir("download");
      downloadedDir = dir;
      unregisterCleanup = registerCleanup(async () => {
        await removePath(dir);
      });
      localPath = join(dir, sanitizeFileName(fileName));
      ui.info(`baixando ${resolved.assetName ?? fileName} (canal ${resolved.channel})`);
      const download = await downloadToFile({
        url: resolved.downloadUrl,
        destinationPath: localPath,
        policy: networkPolicy(ctx),
        headers: resolved.headers,
        maxBytes: maxDownloadBytes(ctx),
        expectedSha256: ctx.opts.sha256 ?? resolved.expectedSha256,
        expectedSize: resolved.expectedSize,
        onProgress: (received, total) => {
          const totalLabel = total === null ? "" : ` de ${formatBytes(total)}`;
          ui.progress(`baixando ${formatBytes(received)}${totalLabel}`);
        },
      });
      ui.endProgress();
      size = download.size;
      sha256 = download.sha256;
      source = {
        ...source,
        resolvedUrl: source.resolvedUrl ?? download.finalUrl,
        etag: download.etag,
        lastModified: download.lastModified,
        size: download.size,
      };
      ui.info(`baixado ${formatBytes(download.size)} · sha256 ${download.sha256.slice(0, 12)}…`);
      for (const note of resolved.notes) ui.verbose(note);
    }

    const result = await applyArtifact({
      ctx,
      localPath,
      fileName,
      sizeBytes: size,
      sha256,
      source,
      releaseTag: resolved.releaseTag,
      existingItem,
      mode,
      displayNameHint: null,
      assetName: resolved.assetName,
      acceptedArchMismatch: archConcern.acceptedMismatch,
      preAcceptedOverrides: archConcern.overrides,
    });
    return buildReport(command, result, resolved, fileName, size, sha256, ctx.opts.dryRun);
  } catch (error) {
    ui.endProgress();
    throw error;
  } finally {
    if (unregisterCleanup !== null) unregisterCleanup();
    if (downloadedDir !== null) {
      if (keepDownloads(ctx)) {
        ui.info(`download preservado em ${downloadedDir}`);
      } else {
        await removePath(downloadedDir).catch(() => {
          ui.verbose(`não foi possível remover ${downloadedDir}`);
        });
      }
    }
  }
}

function planReport(
  command: "install" | "update",
  resolved: ResolvedSource,
  fileName: string,
  existingItem: RegistryItem | null,
): OperationReport {
  const notes = [...resolved.notes];
  notes.push(`canal: ${resolved.channel}`);
  if (resolved.headTag !== null) notes.push(`última release do canal: ${resolved.headTag}`);
  if (resolved.releaseTag !== null) notes.push(`release escolhida: ${resolved.releaseTag}`);
  if (resolved.pinnedTag !== null) notes.push(`fixado em: ${resolved.pinnedTag}`);
  if (resolved.assetName !== null) notes.push(`asset: ${resolved.assetName}`);
  if (resolved.expectedSize !== null) notes.push(`tamanho anunciado: ${formatBytes(resolved.expectedSize)}`);
  if (resolved.expectedSha256 !== null) notes.push(`sha256 anunciado: ${resolved.expectedSha256}`);
  notes.push("o download e a inspeção do artefato não foram executados (--dry-run)");
  notes.push("a versão e a identidade só são confirmadas após o download");

  return {
    command,
    action: "planned",
    itemId: existingItem?.id ?? null,
    displayName: existingItem?.displayName ?? null,
    installedPath: existingItem?.installedPath ?? null,
    installedVersion: existingItem?.installedVersion ?? null,
    previousVersion: null,
    source: {
      kind: resolved.source.kind,
      repository: resolved.source.repository,
      url: resolved.source.resolvedUrl,
      tag: resolved.releaseTag,
      asset: resolved.assetName,
      channel: resolved.channel,
      pinnedTag: resolved.pinnedTag,
    },
    artifact: { fileName, size: resolved.expectedSize, sha256: resolved.expectedSha256 },
    warnings: [],
    notes,
    dryRun: true,
  };
}

export function buildReport(
  command: "install" | "update",
  result: ApplyResult,
  resolved: ResolvedSource,
  fileName: string,
  size: number,
  sha256: string,
  dryRun: boolean,
): OperationReport {
  const source: SourceInfo | null = result.item?.source ?? resolved.source;
  return {
    command,
    action: result.action,
    itemId: result.item?.id ?? null,
    displayName: result.item?.displayName ?? null,
    installedPath: result.installedPath,
    installedVersion: result.installedVersion,
    previousVersion: result.previousVersion,
    source: {
      kind: source.kind,
      repository: source.repository,
      url: source.resolvedUrl,
      tag: resolved.releaseTag,
      asset: resolved.assetName,
      channel: resolved.channel,
      pinnedTag: source.pinnedTag ?? resolved.pinnedTag,
    },
    artifact: { fileName, size, sha256 },
    warnings: result.warnings,
    notes: [...resolved.notes, ...result.notes],
    dryRun,
  };
}

export function reportToJson(report: OperationReport): Record<string, unknown> {
  return {
    schemaVersion: 1,
    command: report.command,
    action: report.action,
    item:
      report.itemId === null
        ? null
        : {
            id: report.itemId,
            displayName: report.displayName,
            installedPath: report.installedPath,
            installedVersion: report.installedVersion,
            previousVersion: report.previousVersion,
          },
    installedPath: report.installedPath,
    installedVersion: report.installedVersion,
    previousVersion: report.previousVersion,
    displayName: report.displayName,
    source: report.source,
    artifact: report.artifact,
    warnings: report.warnings,
    notes: report.notes,
    dryRun: report.dryRun,
  };
}

export function renderReport(report: OperationReport): void {
  const labels: Record<ApplyAction, string> = {
    installed: "instalado",
    updated: "atualizado",
    noop: "nenhuma alteração",
    "keep-both": "cópia adicional instalada",
    planned: "plano (dry-run)",
  };
  process.stdout.write(`${labels[report.action]}\n`);
  if (report.displayName !== null) process.stdout.write(`  item: ${report.displayName} (${report.itemId})\n`);
  if (report.installedVersion !== null) {
    const previous = report.previousVersion === null ? "" : ` (antes: ${report.previousVersion})`;
    process.stdout.write(`  versão: ${report.installedVersion}${previous}\n`);
  }
  if (report.installedPath !== null) process.stdout.write(`  caminho: ${report.installedPath}\n`);
  process.stdout.write(`  origem: ${describeSource(report.source)}\n`);
  process.stdout.write(
    `  artefato: ${report.artifact.fileName}${report.artifact.size === null ? "" : ` (${formatBytes(report.artifact.size)})`}\n`,
  );
  if (report.dryRun) process.stdout.write("  modo: simulação — nada foi alterado\n");
  for (const note of report.notes) process.stdout.write(`  · ${note}\n`);
  for (const warning of report.warnings) process.stdout.write(`  ! ${warning}\n`);
}

export function describeSource(source: OperationReport["source"]): string {
  if (source.repository !== null) {
    const tag = source.tag === null ? "" : `@${source.tag}`;
    const asset = source.asset === null ? "" : ` (${source.asset})`;
    const pinned = source.pinnedTag === null ? "" : ` [fixado em ${source.pinnedTag}]`;
    return `github ${source.repository}${tag}${asset} · canal ${source.channel}${pinned}`;
  }
  if (source.url !== null) return source.url;
  return source.kind;
}

function sanitizeFileName(name: string): string {
  const base = basename(name).replace(/[^\w.@+-]+/g, "_");
  return base.length === 0 ? "artefato" : base;
}
