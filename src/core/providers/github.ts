import { NetworkError, UsageError } from "../errors.ts";
import { USER_AGENT } from "../input/download.ts";
import { redactUrl } from "../input/resolve.ts";
import {
  archCompatibility,
  classifyArchName,
  describeAssetArch,
  type AssetArch,
  type MachineArch,
} from "../system.ts";

export interface GithubAsset {
  id: number;
  name: string;
  size: number | null;
  contentType: string | null;
  digest: string | null;
  browserDownloadUrl: string;
  apiUrl: string;
  updatedAt: string | null;
}

export interface GithubRelease {
  tag: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  publishedAt: string | null;
  createdAt: string | null;
  assets: GithubAsset[];
}

export interface GithubClientOptions {
  token?: string | null;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Canal de releases: stable = GitHub `releases/latest`; prerelease = release publicada mais recente (inclui pré-lançamentos). */
export type ReleaseChannel = "stable" | "prerelease";

export interface AssetSelection {
  asset: GithubAsset;
  matchedBy: "asset-name" | "saved-pattern" | "heuristic";
  arch: AssetArch;
}

export interface AssetSelectionAmbiguous {
  ambiguous: true;
  candidates: GithubAsset[];
  installable: GithubAsset[];
}

export interface AssetSelectionIncompatible {
  incompatible: true;
  reason: "no-matching-arch";
  candidates: GithubAsset[];
  installable: GithubAsset[];
  machineArch: MachineArch;
}

export type AssetSelectionResult = AssetSelection | AssetSelectionAmbiguous | AssetSelectionIncompatible;

export class GithubClient {
  private readonly token: string | null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GithubClientOptions = {}) {
    this.token = options.token ?? null;
    this.baseUrl = (options.baseUrl ?? "https://api.github.com").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  static fromEnv(): GithubClient {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;
    // Permite apontar a API para um servidor local em testes (e para GitHub Enterprise).
    const baseUrl = process.env.DMNGR_GITHUB_API_URL ?? "https://api.github.com";
    return new GithubClient({ token, baseUrl });
  }

  get authenticated(): boolean {
    return this.token !== null && this.token.length > 0;
  }

  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  async latestRelease(owner: string, repo: string): Promise<GithubRelease> {
    return await this.requestRelease(`${this.baseUrl}/repos/${owner}/${repo}/releases/latest`);
  }

  async releaseByTag(owner: string, repo: string, tag: string): Promise<GithubRelease> {
    return await this.requestRelease(`${this.baseUrl}/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  }

  async listReleases(owner: string, repo: string, limit = 30): Promise<GithubRelease[]> {
    const raw = await this.request(`${this.baseUrl}/repos/${owner}/${repo}/releases?per_page=${limit}`);
    return parseReleaseList(raw);
  }

  /** Cabeça do canal: stable usa `releases/latest`; prerelease usa a release publicada mais recente. */
  async releaseForChannel(owner: string, repo: string, channel: ReleaseChannel): Promise<GithubRelease> {
    if (channel === "stable") return await this.latestRelease(owner, repo);
    const releases = await this.listReleases(owner, repo);
    const newest = newestPublishedRelease(releases);
    if (newest === null) {
      throw new NetworkError("o repositório não tem releases publicadas", {
        details: { status: 404, repository: `${owner}/${repo}`, channel },
      });
    }
    return newest;
  }

  private async requestRelease(url: string): Promise<GithubRelease> {
    return parseRelease(await this.request(url));
  }

  private async request(url: string): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": USER_AGENT,
    };
    if (this.token !== null && this.token.length > 0) headers.authorization = `Bearer ${this.token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      throw new NetworkError(`falha de rede ao consultar a API do GitHub (${redactUrl(url)})`, { cause: error });
    }

    if (response.status === 404) {
      throw new NetworkError("repositório ou release não encontrado no GitHub", {
        hint: this.authenticated ? "confirme owner/repo e a tag" : "para repositórios privados, defina GITHUB_TOKEN",
        details: { status: 404, url: redactUrl(url) },
      });
    }
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get("x-ratelimit-remaining");
      const rateLimited = remaining === "0" || response.status === 429;
      throw new NetworkError(
        rateLimited ? "limite de requisições da API do GitHub atingido" : `acesso negado pela API do GitHub (HTTP ${response.status})`,
        {
          hint: "defina GITHUB_TOKEN para aumentar o limite e acessar repositórios privados",
          details: { status: response.status, url: redactUrl(url), rateLimited: true },
        },
      );
    }
    if (response.status >= 500) {
      throw new NetworkError(`a API do GitHub respondeu HTTP ${response.status}`, {
        details: { status: response.status, url: redactUrl(url) },
      });
    }
    if (response.status !== 200) {
      throw new NetworkError(`resposta inesperada da API do GitHub (HTTP ${response.status})`, {
        details: { status: response.status, url: redactUrl(url) },
      });
    }

    return await response.json();
  }
}

export function parseRelease(raw: unknown): GithubRelease {
  if (typeof raw !== "object" || raw === null) {
    throw new NetworkError("resposta da API do GitHub em formato inesperado");
  }
  const release = raw as Record<string, unknown>;
  const tag = typeof release.tag_name === "string" ? release.tag_name : null;
  if (tag === null) {
    throw new NetworkError("release do GitHub sem tag_name");
  }
  const assetsRaw = Array.isArray(release.assets) ? release.assets : [];
  const assets: GithubAsset[] = [];
  for (const entry of assetsRaw) {
    if (typeof entry !== "object" || entry === null) continue;
    const asset = entry as Record<string, unknown>;
    const name = typeof asset.name === "string" ? asset.name : null;
    const browserDownloadUrl = typeof asset.browser_download_url === "string" ? asset.browser_download_url : null;
    const apiUrl = typeof asset.url === "string" ? asset.url : null;
    if (name === null || browserDownloadUrl === null) continue;
    assets.push({
      id: typeof asset.id === "number" ? asset.id : 0,
      name,
      size: typeof asset.size === "number" ? asset.size : null,
      contentType: typeof asset.content_type === "string" ? asset.content_type : null,
      digest: typeof asset.digest === "string" ? asset.digest : null,
      browserDownloadUrl,
      apiUrl: apiUrl ?? browserDownloadUrl,
      updatedAt: typeof asset.updated_at === "string" ? asset.updated_at : null,
    });
  }
  return {
    tag,
    name: typeof release.name === "string" ? release.name : null,
    draft: release.draft === true,
    prerelease: release.prerelease === true,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
    createdAt: typeof release.created_at === "string" ? release.created_at : null,
    assets,
  };
}

/** Lista de releases: ignora rascunhos e entradas sem tag. */
export function parseReleaseList(raw: unknown): GithubRelease[] {
  if (!Array.isArray(raw)) {
    throw new NetworkError("resposta da API do GitHub em formato inesperado (lista de releases esperada)");
  }
  const releases: GithubRelease[] = [];
  for (const entry of raw) {
    try {
      const release = parseRelease(entry);
      if (release.draft) continue;
      releases.push(release);
    } catch {
      continue;
    }
  }
  return releases;
}

/** Release publicada mais recente (estável ou pré-lançamento), por data de publicação. */
export function newestPublishedRelease(releases: GithubRelease[]): GithubRelease | null {
  const published = releases.filter((release) => !release.draft);
  if (published.length === 0) return null;
  return [...published].sort((left, right) => releaseDate(right).localeCompare(releaseDate(left)))[0] ?? null;
}

function releaseDate(release: GithubRelease): string {
  return release.publishedAt ?? release.createdAt ?? "";
}

export function sha256FromDigest(digest: string | null): string | null {
  if (digest === null) return null;
  const match = /^sha256:([0-9a-f]{64})$/i.exec(digest.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function isInstallableAssetName(name: string): boolean {
  return /\.(dmg|pkg)$/i.test(name);
}

export type AssetPlatform = "mac" | "windows" | "linux" | "unknown";

const WINDOWS_TOKENS = ["win", "windows", "win32", "win64", "msi", "msix", "exe"];
const LINUX_TOKENS = ["linux", "ubuntu", "debian", "fedora", "appimage", "flatpak", "snap", "deb", "rpm", "linuxstatic"];
const MAC_TOKENS = ["mac", "macos", "osx", "darwin", "univ", "universal"];

function hasToken(name: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(name);
}

/** Plataforma alvo inferida pelo nome do asset — `.dmg`/`.pkg` já são indício de macOS. */
export function classifyAssetPlatform(name: string): AssetPlatform {
  const windows = WINDOWS_TOKENS.some((token) => hasToken(name, token));
  const linux = LINUX_TOKENS.some((token) => hasToken(name, token));
  const mac = MAC_TOKENS.some((token) => hasToken(name, token)) || /\.(dmg|pkg)$/i.test(name);
  // Um token explícito de outro sistema vence a extensão: "App-windows.dmg" não é um build macOS.
  if (windows && !linux) return "windows";
  if (linux && !windows) return "linux";
  if (mac) return "mac";
  if (windows) return "windows";
  if (linux) return "linux";
  return "unknown";
}

export function isMacAsset(name: string): boolean {
  const platform = classifyAssetPlatform(name);
  return platform === "mac" || platform === "unknown";
}

export interface AssetSelectionOptions {
  assetName?: string | null;
  savedPattern?: string | null;
  machineArch: MachineArch;
  /** Arquiteturas do item instalado (updates) — preserva apps universais. */
  preferredArchs?: string[] | null;
}

/**
 * Seleciona o asset instalável para macOS, priorizando a arquitetura da máquina.
 * Nunca escolhe sozinho entre vários candidatos igualmente compatíveis, e nunca
 * devolve um asset que não possa rodar nesta máquina.
 */
export function selectReleaseAsset(release: GithubRelease, options: AssetSelectionOptions): AssetSelectionResult | null {
  const installable = release.assets.filter((asset) => isInstallableAssetName(asset.name) && isMacAsset(asset.name));
  if (installable.length === 0) return null;

  const byExactName = (name: string | null | undefined): GithubAsset | null =>
    name == null ? null : (installable.find((asset) => asset.name === name) ?? null);

  const hintMatch = byExactName(options.assetName);
  if (hintMatch !== null) return { asset: hintMatch, matchedBy: "asset-name", arch: classifyArchName(hintMatch.name) };

  const patternMatch = byExactName(options.savedPattern);
  if (patternMatch !== null) {
    return { asset: patternMatch, matchedBy: "saved-pattern", arch: classifyArchName(patternMatch.name) };
  }

  const classified = installable.map((asset) => ({ asset, arch: classifyArchName(asset.name) }));
  const machine = classified.filter((entry) => entry.arch === options.machineArch);
  const universal = classified.filter((entry) => entry.arch === "universal" || entry.arch === "unknown");
  const other = classified.filter(
    (entry) => entry.arch !== options.machineArch && entry.arch !== "universal" && entry.arch !== "unknown",
  );

  const preferredArchs = options.preferredArchs ?? null;
  const itemIsUniversal = preferredArchs !== null && preferredArchs.length > 1;
  const pool = itemIsUniversal
    ? universal.length > 0
      ? universal
      : machine
    : machine.length > 0
      ? machine
      : universal;

  if (pool.length === 1) {
    const only = pool[0];
    if (only !== undefined) return { asset: only.asset, matchedBy: "heuristic", arch: only.arch };
  }
  if (pool.length > 1) {
    return { ambiguous: true, candidates: pool.map((entry) => entry.asset), installable };
  }

  // Nada compatível: só faz sentido seguir se a outra arquitetura puder rodar via Rosetta 2.
  const onlyOther = other[0];
  if (onlyOther !== undefined && archCompatibility(onlyOther.arch, options.machineArch) === "needs-rosetta") {
    if (other.length === 1) return { asset: onlyOther.asset, matchedBy: "heuristic", arch: onlyOther.arch };
    return { ambiguous: true, candidates: other.map((entry) => entry.asset), installable };
  }

  return {
    incompatible: true,
    reason: "no-matching-arch",
    candidates: other.map((entry) => entry.asset),
    installable,
    machineArch: options.machineArch,
  };
}

export function describeAsset(asset: GithubAsset): string {
  const arch = classifyArchName(asset.name);
  const size = asset.size === null ? "" : `, ${asset.size} bytes`;
  return `${asset.name} (${describeAssetArch(arch)}${size})`;
}

export function describeAssetList(assets: GithubAsset[]): string {
  return assets.map((asset) => describeAsset(asset)).join("; ");
}

export function assertOwnerRepo(value: string): { owner: string; repo: string } {
  const parts = value.split("/");
  const owner = parts[0];
  const repo = parts[1];
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    throw new UsageError(`repositório inválido: ${value}`, { hint: "use o formato owner/repo" });
  }
  return { owner, repo };
}
