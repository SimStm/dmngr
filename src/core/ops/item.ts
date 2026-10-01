import { describeArchs } from "../inspect/app-bundle.ts";
import type {
  ArtifactInfo,
  ArtifactType,
  ItemKind,
  ObservedApp,
  ReceiptInfo,
  RegistryItem,
  SourceInfo,
  VerificationInfo,
  VersionEvidence,
} from "../registry/schema.ts";

export interface ItemDraft {
  kind: ItemKind;
  artifactType: ArtifactType;
  baseId: string;
  displayName: string;
  aliases: string[];
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
  lastResult: string;
}

export function buildRegistryItem(draft: ItemDraft, existing: RegistryItem | null, id: string): RegistryItem {
  const now = new Date().toISOString();
  const aliases = [...new Set([...(existing?.aliases ?? []), ...draft.aliases])].filter(
    (alias) => alias.length > 0 && alias !== draft.displayName,
  );
  const versionChanged = existing !== null && existing.installedVersion !== draft.installedVersion;
  return {
    id,
    displayName: draft.displayName,
    aliases,
    kind: draft.kind,
    artifactType: draft.artifactType,
    bundleId: draft.bundleId,
    installedPath: draft.installedPath,
    installedVersion: draft.installedVersion,
    buildVersion: draft.buildVersion,
    versionEvidence: draft.versionEvidence,
    arch: draft.arch,
    weakIdentity: draft.weakIdentity,
    source: draft.source,
    artifact: draft.artifact,
    receipts: draft.receipts,
    observedApps: draft.observedApps,
    verification: draft.verification,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    lastCheckedAt: existing?.lastCheckedAt ?? null,
    lastCheckStatus: existing?.lastCheckStatus ?? null,
    lastResult: draft.lastResult,
    previousVersion: versionChanged ? (existing?.installedVersion ?? null) : (existing?.previousVersion ?? null),
  };
}

export function archsOf(item: RegistryItem): string[] | null {
  if (item.arch === null) return null;
  const archs = item.arch.split(/\s+/).filter((arch) => arch.length > 0);
  return archs.length > 0 ? archs : null;
}

export function formatArch(arch: string | null): string | null {
  return describeArchs(arch === null ? null : arch.split(/\s+/));
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.app$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "item"
  );
}

export function sameArchs(left: string[] | null, right: string[] | null): boolean {
  if (left === null || right === null) return true;
  const normalize = (values: string[]): string => [...values].sort().join(",");
  return normalize(left) === normalize(right);
}
