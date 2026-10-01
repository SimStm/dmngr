import { basename, extname } from "node:path";
import { AmbiguityError, InstallError, UsageError, toDmngrError } from "../errors.ts";
import { redactUrl, hasSensitiveQuery, type GithubRef, type ParsedInput } from "../input/resolve.ts";
import {
  assertOwnerRepo,
  classifyAssetPlatform,
  selectReleaseAsset,
  sha256FromDigest,
  type GithubAsset,
  type GithubRelease,
  type ReleaseChannel,
} from "../providers/github.ts";
import { emptySource, type RegistryItem, type SourceInfo } from "../registry/schema.ts";
import { ui } from "../output.ts";
import {
  archCompatibility,
  classifyArchName,
  describeAssetArch,
  humanArch,
  type AssetArch,
  type MachineArch,
} from "../system.ts";
import { compareVersions, normalizeTag } from "../versioning.ts";
import { githubRequestHeaders, type Ctx } from "./context.ts";
import { archsOf } from "./item.ts";

export interface ChannelDecisionInfo {
  owner: string;
  repo: string;
  channel: ReleaseChannel;
  pinnedTag: string;
  headTag: string;
  pinnedVersion: string | null;
  headVersion: string | null;
  pinnedIsNewer: boolean;
}

/**
 * Preocupação de arquitetura detectada antes do download (o bundle é validado depois).
 * `impossible` nunca é dispensável: um app arm64 não roda em Mac Intel.
 */
export interface AssetArchConcern {
  kind: "needs-rosetta" | "unknown" | "impossible";
  assetName: string;
  assetArch: AssetArch;
}

export interface ResolvedSource {
  source: SourceInfo;
  downloadUrl: string | null;
  headers: Record<string, string>;
  expectedSha256: string | null;
  expectedSize: number | null;
  releaseTag: string | null;
  assetName: string | null;
  fileNameHint: string | null;
  notes: string[];
  release: GithubRelease | null;
  channel: ReleaseChannel;
  pinnedTag: string | null;
  headTag: string | null;
  archConcern: AssetArchConcern | null;
}

export interface ResolveOptions {
  savedPattern?: string | null;
  /** Arquiteturas do item instalado (updates) — preserva apps universais. */
  archs?: string[] | null;
  machineArch: MachineArch;
  channel: ReleaseChannel;
  pin: boolean;
  latest: boolean;
  chooseAsset?: (candidates: GithubAsset[]) => Promise<GithubAsset>;
  chooseChannel?: (info: ChannelDecisionInfo) => Promise<"pinned" | "channel">;
}

export interface ResolveUpdateOptions {
  channel: ReleaseChannel;
  latest: boolean;
  machineArch: MachineArch;
  chooseAsset?: (candidates: GithubAsset[]) => Promise<GithubAsset>;
  chooseChannel?: (info: ChannelDecisionInfo) => Promise<"pinned" | "channel">;
}

export function channelDecisionMessage(info: ChannelDecisionInfo): string {
  const pinned = info.pinnedVersion ?? info.pinnedTag;
  const head = info.headVersion ?? info.headTag;
  return `a URL aponta para ${info.pinnedTag} (${pinned}), mas a última release do canal ${info.channel} é ${info.headTag} (${head})`;
}

export function channelDecisionHint(): string {
  return "use --pin para manter a versão da URL ou --latest para instalar a mais recente";
}

export async function resolveSourceForInput(ctx: Ctx, input: ParsedInput, options: ResolveOptions): Promise<ResolvedSource> {
  if (options.pin && options.latest) {
    throw new UsageError("use apenas um de --pin ou --latest");
  }
  if (options.pin && (input.github === null || input.github.tag === null)) {
    throw new UsageError("--pin exige uma URL do GitHub que fixe uma versão (…/releases/download/<tag>/…)", {
      hint: "para seguir o canal, use --latest ou simplesmente omita --pin",
    });
  }

  if (input.kind === "file") return fileSource(input, options);

  if (input.github !== null && input.url !== null) {
    try {
      return await resolveGithub(ctx, input, input.github, options);
    } catch (error) {
      const dmngrError = toDmngrError(error);
      if (input.github.asset !== null && input.github.tag !== null && dmngrError.kind === "network") {
        ui.warn("não foi possível consultar a API do GitHub; baixando a URL diretamente");
        return githubAssetFallback(input, input.github, options, [
          "digest e metadados da release indisponíveis (consulta à API falhou)",
          "a verificação de canal/arquitetura não pôde ser feita antes do download",
        ]);
      }
      throw dmngrError;
    }
  }

  return directUrlSource(input, options);
}

async function resolveGithub(ctx: Ctx, input: ParsedInput, ref: GithubRef, options: ResolveOptions): Promise<ResolvedSource> {
  const { owner, repo } = ref;
  const repository = `${owner}/${repo}`;
  const notes: string[] = [];

  const headRelease = await ctx.github.releaseForChannel(owner, repo, options.channel);
  let release = headRelease;
  let pinnedTag: string | null = null;

  if (ref.tag !== null) {
    if (ref.tag === headRelease.tag) {
      if (options.pin) {
        pinnedTag = ref.tag;
        notes.push(`versão fixada em ${ref.tag} (--pin)`);
      }
    } else {
      const pinnedRelease = await ctx.github.releaseByTag(owner, repo, ref.tag);
      const info: ChannelDecisionInfo = {
        owner,
        repo,
        channel: options.channel,
        pinnedTag: pinnedRelease.tag,
        headTag: headRelease.tag,
        pinnedVersion: normalizeTag(pinnedRelease.tag),
        headVersion: normalizeTag(headRelease.tag),
        pinnedIsNewer: compareVersions(normalizeTag(pinnedRelease.tag), normalizeTag(headRelease.tag)) === 1,
      };

      let choice: "pinned" | "channel" | null = null;
      if (options.pin) choice = "pinned";
      else if (options.latest) choice = "channel";
      else if (ctx.opts.dryRun) choice = null;
      else if (options.chooseChannel !== undefined) choice = await options.chooseChannel(info);
      else {
        throw new AmbiguityError(channelDecisionMessage(info), {
          hint: channelDecisionHint(),
          details: { repository, channel: info.channel, pinnedTag: info.pinnedTag, headTag: info.headTag },
        });
      }

      if (choice === "pinned") {
        release = pinnedRelease;
        pinnedTag = info.pinnedTag;
        notes.push(`usando a versão fixada na URL: ${info.pinnedTag}`);
      } else if (choice === "channel") {
        release = headRelease;
        notes.push(`usando a última release do canal ${options.channel}: ${info.headTag}`);
      } else {
        release = headRelease;
        notes.push(
          `a URL fixa ${info.pinnedTag}, mas a última release do canal ${options.channel} é ${info.headTag}; interativamente o dmngr pergunta qual usar (--pin mantém a da URL, --latest segue o canal)`,
        );
      }
    }
  }

  const selection = selectReleaseAsset(release, {
    assetName: ref.asset,
    savedPattern: options.savedPattern ?? null,
    machineArch: options.machineArch,
    preferredArchs: options.archs ?? null,
  });

  if (selection === null) {
    throw new InstallError(`a release ${release.tag} não publica arquivos .dmg/.pkg para macOS`, {
      details: { repository, tag: release.tag, assets: release.assets.map((asset) => asset.name) },
    });
  }
  if ("incompatible" in selection) {
    throw new InstallError(`não há build compatível com ${humanArch(options.machineArch)} na release ${release.tag}`, {
      hint: "escolha outra release (--pin/--latest) ou outro repositório",
      details: {
        repository,
        tag: release.tag,
        machineArch: options.machineArch,
        assetsMac: selection.installable.map((asset) => asset.name),
        assetsIncompativeis: selection.candidates.map((asset) => asset.name),
      },
    });
  }

  let asset: GithubAsset;
  if ("ambiguous" in selection) {
    if (options.chooseAsset === undefined) {
      throw new AmbiguityError("mais de um asset compatível na release", {
        hint: "escolha interativamente ou informe a URL do asset específico",
        details: { release: release.tag, candidates: selection.candidates.map((entry) => entry.name) },
      });
    }
    asset = await options.chooseAsset(selection.candidates);
  } else {
    asset = selection.asset;
    if (selection.matchedBy === "heuristic") {
      notes.push(`asset escolhido por arquitetura (${humanArch(options.machineArch)}): ${asset.name}`);
    }
  }

  if (ref.asset !== null && asset.name !== ref.asset) {
    notes.push(`a release ${release.tag} não publica ${ref.asset}; usando ${asset.name}`);
  }
  const platform = classifyAssetPlatform(asset.name);
  if (platform === "unknown") {
    notes.push(`plataforma de ${asset.name} não declarada no nome; tratada como macOS`);
  }

  const archConcern = assetArchConcern(asset, options.machineArch, notes);

  return await buildGithubResolvedSource(ctx, input, {
    release,
    asset,
    repository,
    channel: options.channel,
    pinnedTag,
    headTag: headRelease.tag,
    archConcern,
    notes,
  });
}

export function assetArchConcern(asset: GithubAsset, machineArch: MachineArch, notes?: string[]): AssetArchConcern | null {
  const assetArch = classifyArchName(asset.name);
  const compatibility = archCompatibility(assetArch, machineArch);
  if (compatibility === "impossible") {
    notes?.push(`${asset.name} é ${describeAssetArch(assetArch)} e esta máquina é ${humanArch(machineArch)}: não roda aqui`);
    return { kind: "impossible", assetName: asset.name, assetArch };
  }
  if (compatibility === "needs-rosetta") {
    notes?.push(`${asset.name} é ${describeAssetArch(assetArch)} e esta máquina é ${humanArch(machineArch)}: depende do Rosetta 2`);
    return { kind: "needs-rosetta", assetName: asset.name, assetArch };
  }
  if (compatibility === "unknown") {
    notes?.push(`arquitetura de ${asset.name} não identificada pelo nome; será confirmada após o download`);
    return { kind: "unknown", assetName: asset.name, assetArch };
  }
  return null;
}

interface BuildGithubParams {
  release: GithubRelease;
  asset: GithubAsset;
  repository: string;
  channel: ReleaseChannel;
  pinnedTag: string | null;
  headTag: string | null;
  archConcern: AssetArchConcern | null;
  notes: string[];
}

async function buildGithubResolvedSource(
  ctx: Ctx,
  input: ParsedInput,
  params: BuildGithubParams,
): Promise<ResolvedSource> {
  const digest = sha256FromDigest(params.asset.digest);
  const useApiUrl = ctx.github.authenticated && params.asset.id > 0;
  return {
    source: {
      ...emptySource(),
      kind: "github-release",
      inputUrl: input.url === null ? null : redactUrl(input.url),
      resolvedUrl: redactUrl(params.asset.browserDownloadUrl),
      provider: "github",
      repository: params.repository,
      assetPattern: params.asset.name,
      channel: params.channel,
      size: params.asset.size,
      pinnedTag: params.pinnedTag,
    },
    downloadUrl: useApiUrl ? params.asset.apiUrl : params.asset.browserDownloadUrl,
    headers: useApiUrl ? { accept: "application/octet-stream", ...githubRequestHeaders() } : {},
    expectedSha256: digest,
    expectedSize: params.asset.size,
    releaseTag: params.release.tag,
    assetName: params.asset.name,
    fileNameHint: params.asset.name,
    notes: params.notes,
    release: params.release,
    channel: params.channel,
    pinnedTag: params.pinnedTag,
    headTag: params.headTag,
    archConcern: params.archConcern,
  };
}

function githubAssetFallback(
  input: ParsedInput,
  ref: GithubRef,
  options: ResolveOptions,
  notes: string[],
): ResolvedSource {
  return {
    source: {
      ...emptySource(),
      kind: "github-release",
      inputUrl: input.url === null ? null : redactUrl(input.url),
      resolvedUrl: input.url === null ? null : redactUrl(input.url),
      provider: "github",
      repository: `${ref.owner}/${ref.repo}`,
      assetPattern: ref.asset,
      channel: options.channel,
      pinnedTag: ref.tag,
    },
    downloadUrl: input.url,
    headers: {},
    expectedSha256: null,
    expectedSize: null,
    releaseTag: ref.tag,
    assetName: ref.asset,
    fileNameHint: ref.asset,
    notes,
    release: null,
    channel: options.channel,
    pinnedTag: ref.tag,
    headTag: null,
    archConcern: null,
  };
}

function fileSource(input: ParsedInput, options: ResolveOptions): ResolvedSource {
  return {
    source: { ...emptySource(), kind: "local-file", provider: "local" },
    downloadUrl: null,
    headers: {},
    expectedSha256: null,
    expectedSize: null,
    releaseTag: null,
    assetName: null,
    fileNameHint: input.filePath === null ? null : basename(input.filePath),
    notes: [],
    release: null,
    channel: options.channel,
    pinnedTag: null,
    headTag: null,
    archConcern: null,
  };
}

function directUrlSource(input: ParsedInput, options: ResolveOptions): ResolvedSource {
  const url = input.url ?? "";
  const sensitive = hasSensitiveQuery(url);
  const notes: string[] = [];
  const storedUrl = sensitive ? stripQuery(url) : redactUrl(url);
  if (sensitive) {
    notes.push("a URL contém credenciais ou assinatura; o registro guarda apenas a origem sem a query e a atualização exigirá --url");
  }
  return {
    source: {
      ...emptySource(),
      kind: sensitive ? "signed-url" : "direct-url",
      inputUrl: redactUrl(url),
      resolvedUrl: storedUrl,
      provider: "generic",
      channel: options.channel,
    },
    downloadUrl: url,
    headers: {},
    expectedSha256: null,
    expectedSize: null,
    releaseTag: null,
    assetName: null,
    fileNameHint: fileNameFromUrl(url),
    notes,
    release: null,
    channel: options.channel,
    pinnedTag: null,
    headTag: null,
    archConcern: null,
  };
}

export async function resolveSourceForUpdate(
  ctx: Ctx,
  item: RegistryItem,
  options: ResolveUpdateOptions,
): Promise<ResolvedSource> {
  const source = item.source;

  if (source.kind === "github-release" && source.repository !== null) {
    if (source.pinnedTag !== null && !options.latest) {
      throw new UsageError(`o item está fixado em ${source.pinnedTag}`, {
        hint: `use \`dmngr update ${item.id} --latest\` para seguir o canal ${options.channel}`,
      });
    }

    const { owner, repo } = assertOwnerRepo(source.repository);
    const release = await ctx.github.releaseForChannel(owner, repo, options.channel);
    const selection = selectReleaseAsset(release, {
      savedPattern: source.assetPattern,
      machineArch: options.machineArch,
      preferredArchs: archsOf(item),
    });

    const notes: string[] = [];
    const previousTag = item.artifact.releaseTag;
    if (release.tag !== previousTag) notes.push(`release ${previousTag ?? "?"} → ${release.tag}`);
    if (source.pinnedTag !== null && options.latest) notes.push(`a fixação em ${source.pinnedTag} será removida`);
    if (source.channel !== options.channel) notes.push(`canal ${source.channel ?? "stable"} → ${options.channel}`);

    if (selection === null) {
      throw new InstallError(`a release ${release.tag} não publica arquivos .dmg/.pkg para macOS`, {
        details: { repository: source.repository, tag: release.tag, assets: release.assets.map((asset) => asset.name) },
      });
    }
    if ("incompatible" in selection) {
      throw new InstallError(`não há build compatível com ${humanArch(options.machineArch)} na release ${release.tag}`, {
        hint: "escolha outra release ou outro repositório",
        details: {
          repository: source.repository,
          tag: release.tag,
          machineArch: options.machineArch,
          assetsMac: selection.installable.map((asset) => asset.name),
          assetsIncompativeis: selection.candidates.map((asset) => asset.name),
        },
      });
    }

    let asset: GithubAsset;
    if ("ambiguous" in selection) {
      if (options.chooseAsset === undefined) {
        const candidates = selection.candidates.map((entry) => entry.name);
        throw new AmbiguityError("mais de um asset compatível na release mais recente", {
          hint: "escolha interativamente ou use --url",
          details: { release: release.tag, candidates },
        });
      }
      asset = await options.chooseAsset(selection.candidates);
    } else {
      asset = selection.asset;
    }

    const archConcern = assetArchConcern(asset, options.machineArch, notes);
    const input: ParsedInput = {
      kind: "url",
      raw: source.inputUrl ?? release.tag,
      displayUrl: source.inputUrl ?? release.tag,
      url: source.inputUrl,
      filePath: null,
      github: null,
    };
    const resolved = await buildGithubResolvedSource(ctx, input, {
      release,
      asset,
      repository: source.repository,
      channel: options.channel,
      pinnedTag: options.latest ? null : source.pinnedTag,
      headTag: release.tag,
      archConcern,
      notes,
    });
    if (source.kind === "github-release" && source.etag !== null) {
      resolved.source.etag = null;
      resolved.source.lastModified = null;
    }
    return resolved;
  }

  if (source.kind === "direct-url" && source.resolvedUrl !== null) {
    return {
      source: { ...source, etag: null, lastModified: null, size: null },
      downloadUrl: source.resolvedUrl,
      headers: {},
      expectedSha256: null,
      expectedSize: null,
      releaseTag: null,
      assetName: null,
      fileNameHint: item.artifact.fileName ?? fileNameFromUrl(source.resolvedUrl),
      notes: ["a versão remota só é confirmada depois do download"],
      release: null,
      channel: options.channel,
      pinnedTag: null,
      headTag: null,
      archConcern: null,
    };
  }

  throw new UsageError(`a origem deste item não permite atualização automática (${source.kind})`, {
    hint: `use: dmngr update ${item.id} --url <url>`,
  });
}

export function stripQuery(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function fileNameFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const name = basename(url.pathname);
    if (name.length === 0) return null;
    const extension = extname(name);
    return extension.length > 0 ? name : null;
  } catch {
    return null;
  }
}
