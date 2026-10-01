import { stat } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { InstallError } from "../errors.ts";
import { findFiles, isDirectory, readTextFile, removePath } from "../fsx.ts";
import { tempPath } from "../paths.ts";
import { plistToJsonFromText } from "../plist.ts";
import { run, runChecked } from "../process.ts";
import type { ReceiptInfo } from "../registry/schema.ts";

export interface PkgBundleRef {
  path: string | null;
  bundleId: string | null;
  shortVersion: string | null;
  buildVersion: string | null;
}

export interface PkgComponent {
  identifier: string;
  version: string | null;
  installLocation: string | null;
  auth: string | null;
  relocatable: boolean;
  fileCount: number | null;
  sizeKb: number | null;
  hasScripts: boolean;
  bundles: PkgBundleRef[];
}

export interface PkgSignature {
  signed: boolean;
  notarized: boolean;
  authority: string | null;
  teamId: string | null;
  /** Linha "Status:" do pkgutil, para exibição. */
  statusSummary: string | null;
  statusText: string;
}

export interface PkgInfo {
  path: string;
  flat: boolean;
  title: string | null;
  components: PkgComponent[];
  signature: PkgSignature;
  /** Indício de payload que instala mais de um item relevante. */
  hasMultipleComponents: boolean;
}

/**
 * Inspeciona um pacote sem instalar: identifica componentes, versões,
 * install-location, presença de scripts e assinatura.
 *
 * Observação: PackageInfo não é um plist válido para o plutil (root tag
 * `<pkg-info>`), por isso os atributos são extraídos do XML.
 */
export async function inspectPkg(path: string): Promise<PkgInfo> {
  const stats = await stat(path);
  const flat = !stats.isDirectory();
  let expandedRoot = path;
  let cleanupRoot: string | null = null;

  if (flat) {
    const target = await tempPath("pkg");
    await runChecked(["pkgutil", "--expand", path, target], {
      message: "não foi possível expandir o pacote (arquivo corrompido?)",
      kind: "install",
    });
    expandedRoot = target;
    cleanupRoot = target;
  }

  try {
    const packageInfoFiles = await findFiles(expandedRoot, (name) => name === "PackageInfo", 3);
    const distributionFiles = await findFiles(expandedRoot, (name) => name === "Distribution", 2);

    const components: PkgComponent[] = [];
    for (const file of packageInfoFiles) {
      const parsed = await parsePackageInfo(file);
      if (parsed !== null) components.push(parsed);
    }

    let title: string | null = null;
    for (const file of distributionFiles) {
      const distribution = await parseDistribution(file);
      if (title === null) title = distribution.title;
      for (const component of distribution.components) {
        const existing = components.find((entry) => entry.identifier === component.identifier);
        if (existing === undefined) {
          components.push(component);
        } else {
          existing.version ??= component.version;
          if (existing.bundles.length === 0) existing.bundles = component.bundles;
        }
      }
    }

    if (components.length === 0) {
      throw new InstallError(`não foi possível identificar os componentes do pacote: ${path}`, {
        hint: "o pacote pode estar corrompido ou usar um formato não suportado",
      });
    }

    const signature = await inspectPkgSignature(path);
    return {
      path,
      flat,
      title,
      components,
      signature,
      hasMultipleComponents: components.length > 1,
    };
  } finally {
    if (cleanupRoot !== null) {
      await removePath(cleanupRoot).catch(() => {
        /* melhor esforço */
      });
    }
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z0-9_.:-]+)="([^"]*)"/g)) {
    const key = match[1];
    const value = match[2];
    if (key !== undefined && value !== undefined) attributes[key] = decodeXmlEntities(value);
  }
  return attributes;
}

function extractBundles(text: string): PkgBundleRef[] {
  const bundles: PkgBundleRef[] = [];
  for (const match of text.matchAll(/<bundle\s([^>]*?)\/?>/g)) {
    const attributes = attributesOf(match[1] ?? "");
    bundles.push({
      path: attributes.path ?? null,
      bundleId: attributes.id ?? null,
      shortVersion: attributes.CFBundleShortVersionString ?? null,
      buildVersion: attributes.CFBundleVersion ?? null,
    });
  }
  return bundles;
}

async function parsePackageInfo(file: string): Promise<PkgComponent | null> {
  const text = await readTextFile(file);
  const rootMatch = /<pkg-info\b([^>]*)>/.exec(text);
  if (rootMatch === null) return null;
  const attributes = attributesOf(rootMatch[1] ?? "");
  const identifier = attributes.identifier;
  if (identifier === undefined) return null;
  const payloadMatch = /<payload\b([^>]*?)\/?>/.exec(text);
  const payload = payloadMatch === null ? {} : attributesOf(payloadMatch[1] ?? "");
  const hasScripts = await isDirectory(join(dirname(file), "Scripts"));
  return {
    identifier,
    version: attributes.version ?? null,
    installLocation: attributes["install-location"] ?? null,
    auth: attributes.auth ?? null,
    relocatable: attributes.relocatable === "true",
    fileCount: payload.numberOfFiles !== undefined ? Number.parseInt(payload.numberOfFiles, 10) : null,
    sizeKb: payload.installKBytes !== undefined ? Number.parseInt(payload.installKBytes, 10) : null,
    hasScripts,
    bundles: extractBundles(text),
  };
}

async function parseDistribution(
  file: string,
): Promise<{ title: string | null; components: PkgComponent[] }> {
  const text = await readTextFile(file);
  const titleMatch = /<title>([^<]*)<\/title>/.exec(text);
  const components = new Map<string, PkgComponent>();
  for (const match of text.matchAll(/<pkg-ref\b([^>]*)>?/g)) {
    const attributes = attributesOf(match[1] ?? "");
    const identifier = attributes.id;
    if (identifier === undefined) continue;
    const existing = components.get(identifier);
    const version = attributes.version ?? null;
    if (existing !== undefined) {
      existing.version ??= version;
      continue;
    }
    components.set(identifier, {
      identifier,
      version,
      installLocation: null,
      auth: null,
      relocatable: false,
      fileCount: null,
      sizeKb: attributes.installKBytes !== undefined ? Number.parseInt(attributes.installKBytes, 10) : null,
      hasScripts: false,
      bundles: [],
    });
  }
  for (const [identifier, component] of components) {
    const blockRegex = new RegExp(`<pkg-ref\\b[^>]*id="${escapeRegExp(identifier)}"[^>]*>([\\s\\S]*?)<\\/pkg-ref>`);
    const block = blockRegex.exec(text);
    if (block?.[1] !== undefined) component.bundles = extractBundles(block[1]);
  }
  return { title: titleMatch?.[1]?.trim() ?? null, components: [...components.values()] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function inspectPkgSignature(path: string): Promise<PkgSignature> {
  const check = await run(["pkgutil", "--check-signature", path]);
  const text = `${check.stdout}\n${check.stderr}`.trim();
  const noSignature = /Status:\s*no signature/i.test(text);
  const signed = !noSignature && /signed/i.test(text);
  const authorityMatch = /^\s*\d+\.\s+(.+)$/m.exec(text);
  const authority = authorityMatch?.[1]?.trim() ?? null;
  const teamId = authority === null ? null : (/\(([A-Z0-9]{10})\)\s*$/.exec(authority)?.[1] ?? null);
  const notarizedByPkgutil = /notarization:\s*trusted/i.test(text);

  const spctl = await run(["spctl", "-a", "-vvv", "-t", "install", path]);
  const spctlText = `${spctl.stdout}\n${spctl.stderr}`;
  const accepted = spctl.code === 0;
  const notarized = accepted && (notarizedByPkgutil || /notarized/i.test(spctlText));
  const statusSummary = /Status:\s*(.+)/i.exec(text)?.[1]?.trim() ?? null;

  return { signed, notarized, authority, teamId, statusSummary, statusText: text };
}

export async function readReceipts(identifiers: string[]): Promise<ReceiptInfo[]> {
  const receipts: ReceiptInfo[] = [];
  for (const identifier of identifiers) {
    const info = await run(["pkgutil", "--pkg-info-plist", identifier]);
    if (info.code !== 0) {
      receipts.push({ identifier, version: null, installLocation: null, installed: false });
      continue;
    }
    try {
      const parsed = await plistToJsonFromText<Record<string, unknown>>(info.stdout);
      receipts.push({
        identifier,
        version: stringField(parsed["pkg-version"]),
        installLocation: stringField(parsed["install-location"]),
        installed: true,
      });
    } catch {
      receipts.push({ identifier, version: null, installLocation: null, installed: true });
    }
  }
  return receipts;
}

function stringField(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

export interface PayloadAppPath {
  path: string;
  bundleId: string | null;
  declaredVersion: string | null;
}

/** Caminhos absolutos dos apps declarados no payload (install-location + path do bundle). */
export function payloadAppPaths(info: PkgInfo): PayloadAppPath[] {
  const result: PayloadAppPath[] = [];
  for (const component of info.components) {
    if (component.installLocation === null) continue;
    for (const bundle of component.bundles) {
      if (bundle.path === null || bundle.bundleId === null) continue;
      const absolute = posix.join(component.installLocation, bundle.path.replace(/^\.\//, ""));
      result.push({ path: absolute, bundleId: bundle.bundleId, declaredVersion: bundle.shortVersion });
    }
  }
  return result;
}

/** Identificadores usados como identidade primária do item. */
export function primaryPkgIdentifier(info: PkgInfo): string {
  const first = info.components[0];
  if (first === undefined) {
    throw new InstallError(`pacote sem componentes identificáveis: ${info.path}`);
  }
  return first.identifier;
}
