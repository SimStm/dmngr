import { StateError } from "../errors.ts";
import { SCHEMA_VERSION } from "../../version.ts";

export type ItemKind = "app" | "pkg";
export type ArtifactType = "dmg" | "pkg" | "dir";
export type VersionEvidence =
  | "bundle-info-plist"
  | "pkg-receipt"
  | "distribution-xml"
  | "release-tag"
  | "user-provided"
  | "unknown";
export type SourceKind = "github-release" | "direct-url" | "signed-url" | "local-file" | "unknown";

export interface TagComparable {
  tag: string;
  appVersion: string;
  observedAt: string;
}

export interface SourceInfo {
  kind: SourceKind;
  inputUrl: string | null;
  resolvedUrl: string | null;
  provider: string | null;
  repository: string | null;
  assetPattern: string | null;
  channel: string | null;
  etag: string | null;
  lastModified: string | null;
  size: number | null;
  tagComparable: TagComparable | null;
  /** Tag fixada deliberadamente (URL pinada ou --pin); null = seguir o canal. */
  pinnedTag: string | null;
}

export interface ArtifactInfo {
  sha256: string | null;
  size: number | null;
  releaseTag: string | null;
  fileName: string | null;
}

export interface ReceiptInfo {
  identifier: string;
  version: string | null;
  installLocation: string | null;
  installed: boolean;
}

export interface ObservedApp {
  path: string;
  bundleId: string | null;
  version: string | null;
}

export interface VerificationInfo {
  integrityOk: boolean | null;
  signed: boolean | null;
  notarized: boolean | null;
  teamId: string | null;
  overrides: string[];
}

export interface RegistryItem {
  id: string;
  displayName: string;
  aliases: string[];
  kind: ItemKind;
  artifactType: ArtifactType;
  bundleId: string | null;
  installedPath: string | null;
  installedVersion: string | null;
  buildVersion: string | null;
  versionEvidence: VersionEvidence;
  arch: string | null;
  weakIdentity: boolean;
  source: SourceInfo;
  artifact: ArtifactInfo;
  receipts: ReceiptInfo[];
  observedApps: ObservedApp[];
  verification: VerificationInfo;
  installedAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastCheckStatus: string | null;
  lastResult: string | null;
  previousVersion: string | null;
}

export interface Registry {
  schemaVersion: number;
  items: RegistryItem[];
}

export function emptyRegistry(): Registry {
  return { schemaVersion: SCHEMA_VERSION, items: [] };
}

export function emptySource(): SourceInfo {
  return {
    kind: "unknown",
    inputUrl: null,
    resolvedUrl: null,
    provider: null,
    repository: null,
    assetPattern: null,
    channel: null,
    etag: null,
    lastModified: null,
    size: null,
    tagComparable: null,
    pinnedTag: null,
  };
}

export function emptyArtifact(): ArtifactInfo {
  return { sha256: null, size: null, releaseTag: null, fileName: null };
}

export function emptyVerification(): VerificationInfo {
  return { integrityOk: null, signed: null, notarized: null, teamId: null, overrides: [] };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(context: string, detail: string): never {
  throw new StateError(`registro inválido em ${context}: ${detail}`, {
    hint: "rode `dmngr doctor` ou restaure um backup do registro",
  });
}

function requireString(value: unknown, context: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) fail(context, `"${field}" deve ser string não vazia`);
  return value;
}

function optionalString(value: unknown, context: string, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(context, `"${field}" deve ser string ou null`);
  return value;
}

function optionalBoolean(value: unknown, context: string, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") fail(context, `"${field}" deve ser booleano ou null`);
  return value;
}

function optionalNumber(value: unknown, context: string, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(context, `"${field}" deve ser número ou null`);
  return value;
}

function stringArray(value: unknown, context: string, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(context, `"${field}" deve ser uma lista de strings`);
  }
  return value as string[];
}

function oneOf<T extends string>(value: unknown, context: string, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(context, `"${field}" deve ser um de: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function validateRegistry(raw: unknown, source = "registry.json"): Registry {
  if (!isRecord(raw)) fail(source, "o conteúdo não é um objeto");
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== "number") fail(source, '"schemaVersion" ausente ou inválido');
  if (schemaVersion > SCHEMA_VERSION) {
    throw new StateError(`registro usa schemaVersion ${schemaVersion}, mas esta versão do dmngr suporta até ${SCHEMA_VERSION}`, {
      hint: "atualize o dmngr",
      details: { registry: source },
    });
  }
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw)) fail(source, '"items" deve ser uma lista');

  const items = itemsRaw.map((item, index) => validateItem(item, `${source} · items[${index}]`));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(source, `id duplicado: ${item.id}`);
    seen.add(item.id);
  }
  return { schemaVersion, items };
}

function validateItem(raw: unknown, context: string): RegistryItem {
  if (!isRecord(raw)) fail(context, "item não é um objeto");
  const source = raw.source;
  return {
    id: requireString(raw.id, context, "id"),
    displayName: requireString(raw.displayName, context, "displayName"),
    aliases: stringArray(raw.aliases, context, "aliases"),
    kind: oneOf(raw.kind, context, "kind", ["app", "pkg"] as const),
    artifactType: oneOf(raw.artifactType, context, "artifactType", ["dmg", "pkg", "dir"] as const),
    bundleId: optionalString(raw.bundleId, context, "bundleId"),
    installedPath: optionalString(raw.installedPath, context, "installedPath"),
    installedVersion: optionalString(raw.installedVersion, context, "installedVersion"),
    buildVersion: optionalString(raw.buildVersion, context, "buildVersion"),
    versionEvidence: oneOf(raw.versionEvidence, context, "versionEvidence", [
      "bundle-info-plist",
      "pkg-receipt",
      "distribution-xml",
      "release-tag",
      "user-provided",
      "unknown",
    ] as const),
    arch: optionalString(raw.arch, context, "arch"),
    weakIdentity: raw.weakIdentity === true,
    source: validateSource(source, `${context} · source`),
    artifact: validateArtifact(raw.artifact, `${context} · artifact`),
    receipts: validateReceipts(raw.receipts, `${context} · receipts`),
    observedApps: validateObservedApps(raw.observedApps, `${context} · observedApps`),
    verification: validateVerification(raw.verification, `${context} · verification`),
    installedAt: requireString(raw.installedAt, context, "installedAt"),
    updatedAt: optionalString(raw.updatedAt, context, "updatedAt") ?? requireString(raw.installedAt, context, "installedAt"),
    lastCheckedAt: optionalString(raw.lastCheckedAt, context, "lastCheckedAt"),
    lastCheckStatus: optionalString(raw.lastCheckStatus, context, "lastCheckStatus"),
    lastResult: optionalString(raw.lastResult, context, "lastResult"),
    previousVersion: optionalString(raw.previousVersion, context, "previousVersion"),
  };
}

function validateSource(raw: unknown, context: string): SourceInfo {
  if (!isRecord(raw)) fail(context, "source não é um objeto");
  const tagComparableRaw = raw.tagComparable;
  let tagComparable: TagComparable | null = null;
  if (tagComparableRaw !== undefined && tagComparableRaw !== null) {
    if (!isRecord(tagComparableRaw)) fail(context, "tagComparable inválido");
    tagComparable = {
      tag: requireString(tagComparableRaw.tag, context, "tagComparable.tag"),
      appVersion: requireString(tagComparableRaw.appVersion, context, "tagComparable.appVersion"),
      observedAt: requireString(tagComparableRaw.observedAt, context, "tagComparable.observedAt"),
    };
  }
  return {
    kind: oneOf(raw.kind, context, "kind", ["github-release", "direct-url", "signed-url", "local-file", "unknown"] as const),
    inputUrl: optionalString(raw.inputUrl, context, "inputUrl"),
    resolvedUrl: optionalString(raw.resolvedUrl, context, "resolvedUrl"),
    provider: optionalString(raw.provider, context, "provider"),
    repository: optionalString(raw.repository, context, "repository"),
    assetPattern: optionalString(raw.assetPattern, context, "assetPattern"),
    channel: optionalString(raw.channel, context, "channel"),
    etag: optionalString(raw.etag, context, "etag"),
    lastModified: optionalString(raw.lastModified, context, "lastModified"),
    size: optionalNumber(raw.size, context, "size"),
    tagComparable,
    pinnedTag: optionalString(raw.pinnedTag, context, "pinnedTag"),
  };
}

function validateArtifact(raw: unknown, context: string): ArtifactInfo {
  if (!isRecord(raw)) fail(context, "artifact não é um objeto");
  return {
    sha256: optionalString(raw.sha256, context, "sha256"),
    size: optionalNumber(raw.size, context, "size"),
    releaseTag: optionalString(raw.releaseTag, context, "releaseTag"),
    fileName: optionalString(raw.fileName, context, "fileName"),
  };
}

function validateReceipts(raw: unknown, context: string): ReceiptInfo[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail(context, "receipts deve ser uma lista");
  return raw.map((entry, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(entry)) fail(itemContext, "receipt não é um objeto");
    return {
      identifier: requireString(entry.identifier, itemContext, "identifier"),
      version: optionalString(entry.version, itemContext, "version"),
      installLocation: optionalString(entry.installLocation, itemContext, "installLocation"),
      installed: entry.installed === true,
    };
  });
}

function validateObservedApps(raw: unknown, context: string): ObservedApp[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail(context, "observedApps deve ser uma lista");
  return raw.map((entry, index) => {
    const itemContext = `${context}[${index}]`;
    if (!isRecord(entry)) fail(itemContext, "observedApp não é um objeto");
    return {
      path: requireString(entry.path, itemContext, "path"),
      bundleId: optionalString(entry.bundleId, itemContext, "bundleId"),
      version: optionalString(entry.version, itemContext, "version"),
    };
  });
}

function validateVerification(raw: unknown, context: string): VerificationInfo {
  if (raw === undefined || raw === null) return emptyVerification();
  if (!isRecord(raw)) fail(context, "verification não é um objeto");
  return {
    integrityOk: optionalBoolean(raw.integrityOk, context, "integrityOk"),
    signed: optionalBoolean(raw.signed, context, "signed"),
    notarized: optionalBoolean(raw.notarized, context, "notarized"),
    teamId: optionalString(raw.teamId, context, "teamId"),
    overrides: stringArray(raw.overrides, context, "overrides"),
  };
}
