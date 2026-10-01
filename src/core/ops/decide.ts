import type { AssetSelectionResult, GithubAsset, GithubRelease } from "../providers/github.ts";
import { humanArch } from "../system.ts";
import type { RegistryItem } from "../registry/schema.ts";
import type { UrlMetadata } from "../input/download.ts";
import { compareVersions, normalizeTag } from "../versioning.ts";

export type CheckStatus = "update_available" | "up_to_date" | "unknown" | "not_found" | "error";

export interface CheckOutcome {
  status: CheckStatus;
  reason: string;
  evidence: string;
  installedVersion: string | null;
  availableVersion: string | null;
  releaseTag: string | null;
  hint?: string;
  candidates?: string[];
  asset?: GithubAsset;
}

/**
 * Decide o status de um item cuja origem é uma release do GitHub.
 *
 * Regras: só comparamos tag com versão do app quando o mapeamento tag↔versão
 * foi observado na instalação e a versão instalada não mudou desde então.
 * Caso contrário o resultado é `unknown` — nunca prometemos update sem prova.
 */
export function decideGithubCheck(item: RegistryItem, release: GithubRelease, selection: AssetSelectionResult | null): CheckOutcome {
  const base = {
    installedVersion: item.installedVersion,
    releaseTag: release.tag,
  };

  // Item fixado deliberadamente em uma versão: nunca sugerimos trocar de canal sozinhos.
  const pinnedTag = item.source.pinnedTag;
  if (pinnedTag !== null && pinnedTag !== release.tag) {
    return {
      ...base,
      status: "unknown",
      reason: "pinado-em-outra-versao",
      evidence: "release-tag",
      availableVersion: normalizeTag(release.tag),
      hint: `item fixado em ${pinnedTag}; a última release do canal é ${release.tag} — use \`dmngr update ${item.id} --latest\` para seguir o canal`,
    };
  }

  if (selection !== null && "incompatible" in selection) {
    return {
      ...base,
      status: "unknown",
      reason: "arquitetura-incompativel",
      evidence: "github-release",
      availableVersion: normalizeTag(release.tag),
      candidates: selection.installable.map((asset) => asset.name),
      hint: `a release ${release.tag} não tem build para ${humanArch(selection.machineArch)}`,
    };
  }

  if (selection === null) {
    return {
      ...base,
      status: "not_found",
      reason: "release-sem-asset-instalavel",
      evidence: "github-release",
      availableVersion: null,
      hint: `a release ${release.tag} não publica arquivos .dmg/.pkg`,
    };
  }
  if ("ambiguous" in selection) {
    return {
      ...base,
      status: "unknown",
      reason: "asset-ambiguo",
      evidence: "github-release",
      availableVersion: null,
      candidates: selection.candidates.map((asset) => asset.name),
      hint: "mais de um asset compatível; rode `dmngr update <id>` para escolher",
    };
  }

  const asset = selection.asset;
  const sameRelease = item.artifact.releaseTag !== null && item.artifact.releaseTag === release.tag;
  const assetSizeChanged = item.source.size !== null && asset.size !== null && item.source.size !== asset.size;

  if (sameRelease) {
    if (assetSizeChanged) {
      return {
        ...base,
        status: "unknown",
        reason: "asset-alterado",
        evidence: "github-release",
        availableVersion: null,
        hint: "o asset da release mudou de tamanho desde a instalação; rode `dmngr update <id>` para inspecionar",
        asset,
      };
    }
    return {
      ...base,
      status: "up_to_date",
      reason: "mesma-release",
      evidence: "release-tag",
      availableVersion: item.installedVersion,
      asset,
    };
  }

  const mapping = item.source.tagComparable;
  const mappingUsable =
    mapping !== null && mapping.appVersion === item.installedVersion && normalizeTag(mapping.tag) === mapping.appVersion;
  const normalizedLatest = normalizeTag(release.tag);

  if (mappingUsable && normalizedLatest !== null) {
    const comparison = compareVersions(normalizedLatest, item.installedVersion);
    if (comparison === 1) {
      return {
        ...base,
        status: "update_available",
        reason: "tag-mais-nova",
        evidence: "release-tag (mapeada)",
        availableVersion: normalizedLatest,
        hint: `versão confirmada no download; a release é ${release.tag}`,
        asset,
      };
    }
    if (comparison === 0) {
      return {
        ...base,
        status: "up_to_date",
        reason: "tag-equivalente",
        evidence: "release-tag (mapeada)",
        availableVersion: item.installedVersion,
        asset,
      };
    }
    return {
      ...base,
      status: "up_to_date",
      reason: "tag-anterior-a-instalada",
      evidence: "release-tag (mapeada)",
      availableVersion: item.installedVersion,
      hint: `a release mais recente (${release.tag}) tem tag anterior à versão instalada; o app pode ter atualização própria`,
      asset,
    };
  }

  return {
    ...base,
    status: "unknown",
    reason: mapping === null ? "tag-sem-mapeamento" : "tag-nao-mapeavel",
    evidence: "github-release",
    availableVersion: null,
    hint: `a release mais recente é ${release.tag}; rode \`dmngr update <id>\` para baixar e comparar a versão real`,
    asset,
  };
}

/**
 * Fonte de URL fixa: ETag/Last-Modified/tamanho apenas indicam mudança.
 * Nunca declaramos `update_available` sem ler a versão dentro do artefato.
 */
export function decideHttpCheck(item: RegistryItem, probe: UrlMetadata): CheckOutcome {
  const base = { installedVersion: item.installedVersion, releaseTag: null as string | null };

  if (probe.status === 404) {
    return {
      ...base,
      status: "not_found",
      reason: "remote-404",
      evidence: "http",
      availableVersion: null,
      hint: "a URL registrada responde 404; a origem pode ter mudado (use --url)",
    };
  }
  if (probe.status >= 500) {
    return {
      ...base,
      status: "error",
      reason: `http-${probe.status}`,
      evidence: "http",
      availableVersion: null,
      hint: "o servidor respondeu com erro; tente novamente",
    };
  }

  const stored = { etag: item.source.etag, lastModified: item.source.lastModified, size: item.source.size };
  const remote = { etag: probe.etag, lastModified: probe.lastModified, size: probe.contentLength };

  if (stored.etag !== null && remote.etag !== null) {
    return stored.etag === remote.etag
      ? { ...base, status: "up_to_date", reason: "etag-inalterado", evidence: "http (ETag)", availableVersion: item.installedVersion }
      : {
          ...base,
          status: "unknown",
          reason: "recurso-mudou",
          evidence: "http (ETag)",
          availableVersion: null,
          hint: "o arquivo mudou no servidor; rode `dmngr update <id>` para baixar e comparar a versão",
        };
  }
  if (stored.lastModified !== null && remote.lastModified !== null) {
    return stored.lastModified === remote.lastModified
      ? {
          ...base,
          status: "up_to_date",
          reason: "last-modified-inalterado",
          evidence: "http (Last-Modified)",
          availableVersion: item.installedVersion,
        }
      : {
          ...base,
          status: "unknown",
          reason: "recurso-mudou",
          evidence: "http (Last-Modified)",
          availableVersion: null,
          hint: "o arquivo mudou no servidor; rode `dmngr update <id>` para baixar e comparar a versão",
        };
  }
  if (stored.size !== null && remote.size !== null) {
    return stored.size === remote.size
      ? { ...base, status: "up_to_date", reason: "tamanho-inalterado", evidence: "http (tamanho)", availableVersion: item.installedVersion }
      : {
          ...base,
          status: "unknown",
          reason: "recurso-mudou",
          evidence: "http (tamanho)",
          availableVersion: null,
          hint: "o arquivo mudou de tamanho; rode `dmngr update <id>` para baixar e comparar a versão",
        };
  }
  return {
    ...base,
    status: "unknown",
    reason: "sem-metadados",
    evidence: "http",
    availableVersion: null,
    hint: "a fonte não expõe versão; use `dmngr update <id> --url <url>` quando houver nova versão",
  };
}

export function untrackableOutcome(item: RegistryItem): CheckOutcome {
  const hint =
    item.source.kind === "local-file"
      ? "o item foi instalado de um arquivo local; use `dmngr update <id> --url <url>`"
      : "a origem não permite consulta automática; use `dmngr update <id> --url <url>`";
  return {
    status: "unknown",
    reason: "origem-nao-rastreavel",
    evidence: "none",
    installedVersion: item.installedVersion,
    availableVersion: null,
    releaseTag: null,
    hint,
  };
}

export type ArtifactAction = "install" | "noop" | "confirm" | "refuse";

export interface ActionDecision {
  action: ArtifactAction;
  reason: string;
}

export interface ArtifactDecisionInput {
  existing: RegistryItem | null;
  candidateVersion: string | null;
  candidateSha256: string;
  reinstall: boolean;
}

/**
 * Decide o que fazer com um artefato inspecionado:
 *  - mesmo hash/versão  → no-op (ou instala com --reinstall)
 *  - versão desconhecida ou incomparável → confirmação
 *  - downgrade → recusado
 */
export function decideArtifactAction(input: ArtifactDecisionInput): ActionDecision {
  const { existing, candidateVersion, candidateSha256, reinstall } = input;
  if (existing === null) return { action: "install", reason: "novo item" };

  const sameArtifact = existing.artifact.sha256 !== null && existing.artifact.sha256 === candidateSha256;
  if (sameArtifact) {
    return reinstall
      ? { action: "install", reason: "mesmo artefato, --reinstall" }
      : { action: "noop", reason: "o artefato é idêntico ao já instalado" };
  }

  const current = existing.installedVersion;
  const comparison = compareVersions(candidateVersion, current);

  if (comparison === 0) {
    return reinstall
      ? { action: "install", reason: "mesma versão, --reinstall" }
      : { action: "confirm", reason: `mesma versão (${current}), mas o arquivo é diferente do instalado` };
  }
  if (comparison === null) {
    if (candidateVersion === null) return { action: "confirm", reason: "não foi possível determinar a versão do arquivo" };
    if (current === null) return { action: "confirm", reason: "a versão instalada é desconhecida" };
    return { action: "confirm", reason: `versões não comparáveis (instalada ${current}, arquivo ${candidateVersion})` };
  }
  if (comparison === 1) {
    return { action: "install", reason: `atualização ${current ?? "desconhecida"} → ${candidateVersion}` };
  }
  return { action: "refuse", reason: `downgrade: instalado ${current}, arquivo ${candidateVersion}` };
}
