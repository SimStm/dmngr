import { basename, dirname, join } from "node:path";
import { chmod, copyFile, rename } from "node:fs/promises";
import { AmbiguityError, InstallError, NetworkError, UsageError } from "./errors.ts";
import { downloadToFile, formatBytes } from "./input/download.ts";
import type { NetworkPolicy } from "./input/resolve.ts";
import { isWritableDirectory, pathExists, removePath, resolveRealPath, sha256File } from "./fsx.ts";
import { createTempDir } from "./paths.ts";
import { GithubClient, type GithubAsset, type GithubRelease } from "./providers/github.ts";
import { machineArch, type MachineArch } from "./system.ts";
import { compareVersions, normalizeTag } from "./versioning.ts";
import { VERSION } from "../version.ts";
import { ui } from "./output.ts";
import { confirm } from "./prompts.ts";

export const DMNGR_GITHUB_OWNER = "SimStm";
export const DMNGR_GITHUB_REPO = "dmngr";

export type SelfUpdateStatus = "up_to_date" | "update_available" | "unknown";

export interface SelfUpdatePlan {
  currentVersion: string;
  latestTag: string;
  latestVersion: string | null;
  status: SelfUpdateStatus;
  assetName: string;
  downloadUrl: string;
  sha256Url: string | null;
  expectedSha256: string | null;
  installPath: string;
  machineArch: MachineArch;
}

export interface SelfUpdateOptions {
  github: GithubClient;
  policy: NetworkPolicy;
  maxBytes: number;
  checkOnly: boolean;
  dryRun: boolean;
  yes: boolean;
  canPrompt: boolean;
  /** Injeta o caminho do binário (testes). */
  installPath?: string | null;
  arch?: MachineArch;
  currentVersion?: string;
}

export interface SelfUpdateResult {
  action: "up_to_date" | "planned" | "updated" | "check";
  plan: SelfUpdatePlan;
  previousVersion: string;
  installedVersion: string | null;
  installPath: string;
  notes: string[];
}

/** Caminho do binário instalado, ou null quando estamos sob o runtime `bun` (dev). */
export function resolveSelfInstallPath(execPath = process.execPath): string | null {
  const base = basename(execPath);
  if (base === "bun" || base.startsWith("bun-")) return null;
  return execPath;
}

export function selfAssetName(arch: MachineArch = machineArch()): string {
  return `dmngr-darwin-${arch}`;
}

export function parseSha256File(text: string, assetName: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^([0-9a-fA-F]{64})(?:\s+\*?(\S+))?$/.exec(line);
    if (match === null) continue;
    const hash = match[1]?.toLowerCase() ?? null;
    const name = match[2] !== undefined ? basename(match[2]) : null;
    if (hash === null) continue;
    if (name === null || name === assetName) return hash;
  }
  return null;
}

export function planFromRelease(
  release: GithubRelease,
  options: {
    currentVersion?: string;
    arch?: MachineArch;
    installPath: string;
  },
): SelfUpdatePlan {
  const arch = options.arch ?? machineArch();
  const currentVersion = options.currentVersion ?? VERSION;
  const assetName = selfAssetName(arch);
  const asset = release.assets.find((item) => item.name === assetName);
  if (asset === undefined) {
    throw new NetworkError(`a release ${release.tag} não publica o asset ${assetName}`, {
      details: { tag: release.tag, assets: release.assets.map((item) => item.name) },
    });
  }
  const shaAsset = release.assets.find((item) => item.name === `${assetName}.sha256`) ?? null;
  const latestVersion = normalizeTag(release.tag);
  let status: SelfUpdateStatus = "unknown";
  if (latestVersion !== null) {
    const cmp = compareVersions(latestVersion, currentVersion);
    if (cmp === 0) status = "up_to_date";
    else if (cmp === 1) status = "update_available";
    else if (cmp === -1) status = "up_to_date"; // local newer / same channel head older — treat as current
  }
  return {
    currentVersion,
    latestTag: release.tag,
    latestVersion,
    status,
    assetName,
    downloadUrl: asset.browserDownloadUrl,
    sha256Url: shaAsset?.browserDownloadUrl ?? null,
    expectedSha256: digestFromAsset(asset),
    installPath: options.installPath,
    machineArch: arch,
  };
}

function digestFromAsset(asset: GithubAsset): string | null {
  if (asset.digest === null) return null;
  const match = /^sha256:([0-9a-fA-F]{64})$/i.exec(asset.digest.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export async function runUpdateSelf(options: SelfUpdateOptions): Promise<SelfUpdateResult> {
  const installPath =
    options.installPath !== undefined ? options.installPath : resolveSelfInstallPath();
  if (installPath === null) {
    throw new UsageError("update-self só funciona com o binário compilado do dmngr", {
      hint: "instale o release de https://github.com/SimStm/dmngr/releases/latest e rode o comando de novo",
    });
  }
  const realPath = (await pathExists(installPath)) ? await resolveRealPath(installPath) : installPath;
  const release = await options.github.latestRelease(DMNGR_GITHUB_OWNER, DMNGR_GITHUB_REPO);
  const plan = planFromRelease(release, {
    currentVersion: options.currentVersion,
    arch: options.arch,
    installPath: realPath,
  });

  if (options.checkOnly) {
    return {
      action: "check",
      plan,
      previousVersion: plan.currentVersion,
      installedVersion: plan.latestVersion,
      installPath: realPath,
      notes: [statusNote(plan)],
    };
  }

  if (plan.status === "up_to_date") {
    ui.info(`dmngr ${plan.currentVersion} já é a versão mais recente (${plan.latestTag})`);
    return {
      action: "up_to_date",
      plan,
      previousVersion: plan.currentVersion,
      installedVersion: plan.currentVersion,
      installPath: realPath,
      notes: [statusNote(plan)],
    };
  }

  if (plan.status === "unknown") {
    throw new NetworkError(`não foi possível comparar ${plan.currentVersion} com a tag ${plan.latestTag}`, {
      hint: "a tag da release precisa parecer uma versão (ex.: v1.2.3)",
      details: { current: plan.currentVersion, tag: plan.latestTag },
    });
  }

  const summary = `atualizar dmngr ${plan.currentVersion} → ${plan.latestVersion} (${plan.latestTag}, ${plan.assetName})`;
  if (options.dryRun) {
    ui.info(`plano: ${summary}`);
    return {
      action: "planned",
      plan,
      previousVersion: plan.currentVersion,
      installedVersion: plan.latestVersion,
      installPath: realPath,
      notes: [`dry-run: ${summary}`],
    };
  }

  if (!options.yes) {
    if (!options.canPrompt) {
      throw new AmbiguityError(`há uma versão nova do dmngr (${plan.latestVersion})`, {
        hint: "rode interativamente ou passe --yes",
        details: { current: plan.currentVersion, latest: plan.latestVersion },
      });
    }
    const ok = await confirm(`${summary}. Continuar?`);
    if (!ok) throw new AmbiguityError("atualização cancelada pelo usuário");
  }

  const parent = dirname(realPath);
  if (!(await isWritableDirectory(parent))) {
    throw new InstallError(`sem permissão de escrita em ${parent}`, {
      hint: "mova o binário para um diretório gravável (ex.: ~/.local/bin) ou rode com permissões adequadas",
      details: { installPath: realPath },
    });
  }

  let expectedSha256 = plan.expectedSha256;
  if (plan.sha256Url !== null) {
    const checksumText = await fetchText(plan.sha256Url, options.policy);
    const parsed = parseSha256File(checksumText, plan.assetName);
    if (parsed !== null) expectedSha256 = parsed;
  }
  if (expectedSha256 === null) {
    throw new NetworkError("não há checksum sha256 publicado para o asset do dmngr", {
      hint: "a release precisa incluir dmngr-darwin-<arch>.sha256",
    });
  }

  const tmp = await createTempDir("update-self");
  const staging = join(tmp, plan.assetName);
  try {
    ui.info(`baixando ${plan.assetName} (${plan.latestTag})`);
    const download = await downloadToFile({
      url: plan.downloadUrl,
      destinationPath: staging,
      policy: options.policy,
      maxBytes: options.maxBytes,
      expectedSha256,
      onProgress: (received, total) => {
        const totalLabel = total === null ? "" : ` de ${formatBytes(total)}`;
        ui.progress(`baixando ${formatBytes(received)}${totalLabel}`);
      },
    });
    ui.endProgress();
    ui.info(`baixado ${formatBytes(download.size)} · sha256 ${download.sha256.slice(0, 12)}…`);

    const stagedHash = await sha256File(staging);
    if (stagedHash !== expectedSha256) {
      throw new NetworkError("o hash do binário baixado não confere após o download", {
        details: { expected: expectedSha256, actual: stagedHash },
      });
    }
    await chmod(staging, 0o755);

    const backup = join(parent, `.${basename(realPath)}.bak-${process.pid}`);
    const next = join(parent, `.${basename(realPath)}.new-${process.pid}`);
    await removePath(next).catch(() => undefined);
    await copyFile(staging, next);
    await chmod(next, 0o755);

    let replaced = false;
    try {
      if (await pathExists(realPath)) await rename(realPath, backup);
      await rename(next, realPath);
      replaced = true;
      await removePath(backup).catch(() => undefined);
    } catch (error) {
      if (!replaced && (await pathExists(backup))) {
        await rename(backup, realPath).catch(() => undefined);
      }
      await removePath(next).catch(() => undefined);
      throw error;
    }

    ui.info(`dmngr atualizado: ${plan.currentVersion} → ${plan.latestVersion} em ${realPath}`);
    return {
      action: "updated",
      plan,
      previousVersion: plan.currentVersion,
      installedVersion: plan.latestVersion,
      installPath: realPath,
      notes: [`atualizado para ${plan.latestTag}`],
    };
  } finally {
    await removePath(tmp).catch(() => undefined);
  }
}

function statusNote(plan: SelfUpdatePlan): string {
  if (plan.status === "up_to_date") return `já na versão mais recente (${plan.latestTag})`;
  if (plan.status === "update_available") {
    return `atualização disponível: ${plan.currentVersion} → ${plan.latestVersion} (${plan.latestTag})`;
  }
  return `versão remota não comparável (${plan.latestTag})`;
}

async function fetchText(url: string, policy: NetworkPolicy): Promise<string> {
  const { assertUrlAllowed } = await import("./input/resolve.ts");
  const allowed = await assertUrlAllowed(url, policy);
  const response = await fetch(allowed, {
    headers: { "user-agent": `dmngr/${VERSION} (macOS CLI)` },
  });
  if (!response.ok) {
    throw new NetworkError(`falha ao baixar checksum (${response.status})`, {
      details: { status: response.status, url },
    });
  }
  return await response.text();
}
