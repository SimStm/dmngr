import { readdir, stat } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { registerCleanup } from "../cleanup.ts";
import { InstallError } from "../errors.ts";
import { pathExists, resolveRealPath, sleep } from "../fsx.ts";
import { isAppBundle } from "../inspect/app-bundle.ts";
import { ui } from "../output.ts";
import { plistToJsonFromText } from "../plist.ts";
import { run } from "../process.ts";

interface HdiutilEntity {
  "dev-entry"?: string;
  "mount-point"?: string;
  "content-hint"?: string;
  "potentially-mountable"?: boolean;
}

interface HdiutilAttachInfo {
  "system-entities"?: HdiutilEntity[];
  "image-path"?: string;
}

export interface AttachedDmg {
  imagePath: string;
  devEntries: string[];
  mountPoints: string[];
}

export interface MountedDmg extends AttachedDmg {
  attach: AttachedDmg;
}

export interface DmgCandidate {
  kind: "app" | "pkg";
  path: string;
  relative: string;
  depth: number;
}

export interface DetachResult {
  ok: boolean;
  message?: string;
}

/**
 * Monta a imagem em modo somente leitura e garante desmontagem em qualquer saída
 * (inclusive erro), registrando no handler de sinais para interrupções.
 */
export async function withMountedDmg<T>(imagePath: string, fn: (mount: MountedDmg) => Promise<T>): Promise<T> {
  const attach = await attachDmg(imagePath);
  const mounted: MountedDmg = { ...attach, attach };
  const unregister = registerCleanup(async () => {
    await detachDmg(attach, { quiet: true });
  });
  try {
    return await fn(mounted);
  } finally {
    unregister();
    const result = await detachDmg(attach);
    if (!result.ok) {
      ui.warn(`não foi possível desmontar ${basename(imagePath)}: ${result.message ?? "motivo desconhecido"}`);
      ui.warn(`os arquivos temporários foram preservados; desmonte com: hdiutil detach ${attach.devEntries[0] ?? "<dev>"}`);
    }
  }
}

export async function attachDmg(imagePath: string): Promise<AttachedDmg> {
  const result = await run(
    ["hdiutil", "attach", "-readonly", "-nobrowse", "-noverify", "-noautoopen", "-plist", imagePath],
    { timeoutMs: 180_000 },
  );
  if (result.code !== 0) {
    throw new InstallError(`não foi possível montar a imagem: ${basename(imagePath)}`, {
      details: tail(result.stderr || result.stdout),
    });
  }

  let info: HdiutilAttachInfo;
  try {
    info = await plistToJsonFromText<HdiutilAttachInfo>(result.stdout);
  } catch (error) {
    throw new InstallError("não foi possível interpretar a saída do hdiutil", { cause: error });
  }

  const entities = info["system-entities"] ?? [];
  const devEntries = unique(entities.map((entity) => entity["dev-entry"]).filter(isString));
  const mountPoints = unique(entities.map((entity) => entity["mount-point"]).filter(isString));

  if (mountPoints.length === 0) {
    const detached = await detachDmg({ imagePath, devEntries, mountPoints: [] }, { quiet: true });
    throw new InstallError("a imagem não contém volume montável", {
      hint: "imagens sem sistema de arquivos (ou criptografadas) não são suportadas",
      details: detached.ok ? undefined : { detach: detached.message },
    });
  }

  return { imagePath, devEntries, mountPoints };
}

export async function detachDmg(attach: AttachedDmg, options: { quiet?: boolean } = {}): Promise<DetachResult> {
  const devices = detachOrder(attach.devEntries);
  if (devices.length === 0) return { ok: true };

  for (const device of devices) {
    await detachDevice(device);
    if (!(await isAttached(attach))) return { ok: true };
  }

  let remaining = await remainingMountPoints(attach);
  if (remaining.length > 0) {
    if (!options.quiet) ui.warn("desmontagem normal falhou; tentando hdiutil detach -force");
    for (const device of devices) await detachDevice(device, { force: true });
    remaining = await remainingMountPoints(attach);
  }
  if (remaining.length > 0) {
    return { ok: false, message: `volumes ainda montados: ${remaining.join(", ")}` };
  }
  return { ok: true };
}

async function detachDevice(device: string, options: { force?: boolean } = {}): Promise<void> {
  const command = options.force ? ["hdiutil", "detach", "-force", device] : ["hdiutil", "detach", device];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await run(command, { timeoutMs: 60_000 });
    if (result.code === 0) return;
    await sleep(500);
  }
}

function detachOrder(devEntries: string[]): string[] {
  const wholeDisks = devEntries.filter((entry) => /^\/dev\/disk\d+$/.test(entry));
  if (wholeDisks.length > 0) return wholeDisks;
  return [...devEntries].reverse();
}

async function isAttached(attach: AttachedDmg): Promise<boolean> {
  const images = await listAttachedImages();
  return images.some((image) => image.imagePath === attach.imagePath);
}

async function remainingMountPoints(attach: AttachedDmg): Promise<string[]> {
  const images = await listAttachedImages();
  const stillAttached = images.some((image) => image.imagePath === attach.imagePath);
  if (stillAttached) return attach.mountPoints;
  const mounted = [] as string[];
  for (const mountPoint of attach.mountPoints) {
    if (await pathExists(mountPoint)) mounted.push(mountPoint);
  }
  return mounted;
}

export interface AttachedImageInfo {
  imagePath: string;
  mountPoints: string[];
  devEntries: string[];
}

/** Imagens atualmente montadas no sistema (usado no doctor). */
export async function listAttachedImages(): Promise<AttachedImageInfo[]> {
  const result = await run(["hdiutil", "info", "-plist"]);
  if (result.code !== 0) return [];
  let info: { images?: (HdiutilAttachInfo & { "image-path"?: string })[] };
  try {
    info = await plistToJsonFromText<{ images?: (HdiutilAttachInfo & { "image-path"?: string })[] }>(result.stdout);
  } catch {
    return [];
  }
  return (info.images ?? []).map((image) => ({
    imagePath: image["image-path"] ?? "",
    mountPoints: unique((image["system-entities"] ?? []).map((entity) => entity["mount-point"]).filter(isString)),
    devEntries: unique((image["system-entities"] ?? []).map((entity) => entity["dev-entry"]).filter(isString)),
  }));
}

/**
 * Procura candidatos instaláveis no volume montado.
 * Regras: ignora dotfiles e symlinks (inclusive o atalho para /Applications),
 * nunca sai do ponto de montagem e prioriza a menor profundidade.
 */
export async function scanMountedImage(root: string, options: { maxDepth?: number } = {}): Promise<DmgCandidate[]> {
  const maxDepth = options.maxDepth ?? 2;
  const realRoot = await resolveRealPath(root);
  const candidates: DmgCandidate[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: realRoot, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) continue;
      const path = join(current.dir, entry.name);
      const relative = path.slice(realRoot.length + 1);

      if (entry.isDirectory() && entry.name.endsWith(".app")) {
        if (await isAppBundle(path)) candidates.push({ kind: "app", path, relative, depth: current.depth });
        continue;
      }
      if (entry.name.endsWith(".pkg") && (entry.isFile() || entry.isDirectory())) {
        candidates.push({ kind: "pkg", path, relative, depth: current.depth });
        continue;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ dir: path, depth: current.depth + 1 });
      }
    }
  }

  const inside: DmgCandidate[] = [];
  for (const candidate of candidates) {
    const real = await resolveRealPath(candidate.path);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) continue;
    inside.push(candidate);
  }
  if (inside.length === 0) return [];
  const minDepth = Math.min(...inside.map((candidate) => candidate.depth));
  return inside
    .filter((candidate) => candidate.depth === minDepth)
    .sort((left, right) => left.relative.localeCompare(right.relative));
}

export async function imageFileSize(imagePath: string): Promise<number> {
  return (await stat(imagePath)).size;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function tail(text: string): string {
  return text.trim().split("\n").slice(-6).join("\n");
}
