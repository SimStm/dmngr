import { describe, expect, test } from "bun:test";
import { decideArtifactAction, decideGithubCheck, decideHttpCheck, untrackableOutcome } from "../../src/core/ops/decide.ts";
import { parseRelease, selectReleaseAsset, type GithubRelease } from "../../src/core/providers/github.ts";
import { emptyArtifact, emptySource, emptyVerification, type RegistryItem } from "../../src/core/registry/schema.ts";

function item(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    id: "acme/editor",
    displayName: "Editor",
    aliases: [],
    kind: "app",
    artifactType: "dmg",
    bundleId: "com.acme.editor",
    installedPath: "/Applications/Editor.app",
    installedVersion: "1.0.0",
    buildVersion: "100",
    versionEvidence: "bundle-info-plist",
    arch: "arm64",
    weakIdentity: false,
    source: emptySource(),
    artifact: { ...emptyArtifact(), sha256: "a".repeat(64) },
    receipts: [],
    observedApps: [],
    verification: emptyVerification(),
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastResult: "installed",
    previousVersion: null,
    ...overrides,
  };
}

function release(tag: string, assetNames: string[] = ["Editor-arm64.dmg"]): GithubRelease {
  return parseRelease({
    tag_name: tag,
    assets: assetNames.map((name, index) => ({
      id: index + 1,
      name,
      size: 1000,
      browser_download_url: `https://github.com/acme/editor/releases/download/${tag}/${name}`,
      url: `https://api.github.com/repos/acme/editor/releases/assets/${index + 1}`,
    })),
  });
}

describe("decideArtifactAction", () => {
  test("item novo instala", () => {
    expect(decideArtifactAction({ existing: null, candidateVersion: "1.0.0", candidateSha256: "b", reinstall: false }).action).toBe(
      "install",
    );
  });

  test("mesmo artefato é no-op, exceto com --reinstall", () => {
    const existing = item();
    const decision = decideArtifactAction({
      existing,
      candidateVersion: "1.0.0",
      candidateSha256: "a".repeat(64),
      reinstall: false,
    });
    expect(decision.action).toBe("noop");
    expect(
      decideArtifactAction({ existing, candidateVersion: "1.0.0", candidateSha256: "a".repeat(64), reinstall: true }).action,
    ).toBe("install");
  });

  test("mesma versão com arquivo diferente pede confirmação", () => {
    const decision = decideArtifactAction({
      existing: item(),
      candidateVersion: "1.0.0",
      candidateSha256: "c".repeat(64),
      reinstall: false,
    });
    expect(decision.action).toBe("confirm");
  });

  test("versão mais nova instala e downgrade é recusado", () => {
    expect(
      decideArtifactAction({ existing: item(), candidateVersion: "1.1.0", candidateSha256: "c", reinstall: false }).action,
    ).toBe("install");
    expect(
      decideArtifactAction({ existing: item(), candidateVersion: "0.9.0", candidateSha256: "c", reinstall: false }).action,
    ).toBe("refuse");
  });

  test("versões desconhecidas ou incomparáveis pedem confirmação", () => {
    expect(
      decideArtifactAction({ existing: item(), candidateVersion: null, candidateSha256: "c", reinstall: false }).action,
    ).toBe("confirm");
    expect(
      decideArtifactAction({
        existing: item({ installedVersion: null }),
        candidateVersion: "1.0.0",
        candidateSha256: "c",
        reinstall: false,
      }).action,
    ).toBe("confirm");
    expect(
      decideArtifactAction({ existing: item(), candidateVersion: "build-xyz", candidateSha256: "c", reinstall: false }).action,
    ).toBe("confirm");
  });
});

describe("decideGithubCheck", () => {
  test("mesma release é up_to_date", () => {
    const current = item({ artifact: { ...emptyArtifact(), releaseTag: "v1.0.0" } });
    const rel = release("v1.0.0");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("up_to_date");
    expect(outcome.evidence).toBe("release-tag");
  });

  test("asset da mesma release que mudou de tamanho vira unknown", () => {
    const current = item({
      artifact: { ...emptyArtifact(), releaseTag: "v1.0.0" },
      source: { ...emptySource(), kind: "github-release", repository: "acme/editor", size: 42 },
    });
    const rel = release("v1.0.0");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBe("asset-alterado");
  });

  test("mapeamento tag↔versão válido permite afirmar update_available", () => {
    const current = item({
      artifact: { ...emptyArtifact(), releaseTag: "v1.0.0" },
      source: {
        ...emptySource(),
        kind: "github-release",
        repository: "acme/editor",
        tagComparable: { tag: "v1.0.0", appVersion: "1.0.0", observedAt: "2026-01-01T00:00:00Z" },
      },
    });
    const rel = release("v1.1.0");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("update_available");
    expect(outcome.availableVersion).toBe("1.1.0");
  });

  test("versão instalada mudou (auto-update) invalida o mapeamento", () => {
    const current = item({
      installedVersion: "1.5.0",
      artifact: { ...emptyArtifact(), releaseTag: "v1.0.0" },
      source: {
        ...emptySource(),
        kind: "github-release",
        repository: "acme/editor",
        tagComparable: { tag: "v1.0.0", appVersion: "1.0.0", observedAt: "2026-01-01T00:00:00Z" },
      },
    });
    const rel = release("v1.1.0");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("unknown");
  });

  test("tag não versionada nunca é comparada", () => {
    const current = item({ artifact: { ...emptyArtifact(), releaseTag: "nightly-1" } });
    const rel = release("nightly-2");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBe("tag-sem-mapeamento");
  });

  test("asset ambíguo e release sem assets instaláveis", () => {
    const current = item();
    const rel = release("v1.2.0", ["Editor.dmg", "Editor.pkg"]);
    const ambiguous = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(ambiguous.status).toBe("unknown");
    expect(ambiguous.candidates).toHaveLength(2);

    const zipOnly = release("v1.2.0", ["fonte.tar.gz"]);
    const notFound = decideGithubCheck(current, zipOnly, selectReleaseAsset(zipOnly, { machineArch: "arm64" }));
    expect(notFound.status).toBe("not_found");
  });

  test("item fixado em outra versão nunca sugere update automático", () => {
    const current = item({
      artifact: { ...emptyArtifact(), releaseTag: "v1.0.0" },
      source: {
        ...emptySource(),
        kind: "github-release",
        repository: "acme/editor",
        channel: "stable",
        pinnedTag: "v1.0.0",
        tagComparable: { tag: "v1.0.0", appVersion: "1.0.0", observedAt: "2026-01-01T00:00:00Z" },
      },
    });
    const rel = release("v1.1.0");
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "arm64" }));
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBe("pinado-em-outra-versao");
    expect(outcome.hint).toContain("--latest");
  });

  test("release sem build para a máquina vira unknown com candidatos", () => {
    const current = item();
    const rel = release("v1.2.0", ["Editor-arm64.dmg"]);
    const outcome = decideGithubCheck(current, rel, selectReleaseAsset(rel, { machineArch: "x64" }));
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBe("arquitetura-incompativel");
    expect(outcome.candidates).toEqual(["Editor-arm64.dmg"]);
  });
});

describe("decideHttpCheck", () => {
  const probe = (status: number, etag: string | null, size: number | null) => ({
    status,
    finalUrl: "https://example.com/App.dmg",
    etag,
    lastModified: null,
    contentLength: size,
    redirects: [],
    method: "HEAD" as const,
  });

  test("ETag igual indica sem mudança; diferente vira unknown", () => {
    const current = item({ source: { ...emptySource(), kind: "direct-url", etag: '"v1"', resolvedUrl: "https://example.com/App.dmg" } });
    expect(decideHttpCheck(current, probe(200, '"v1"', null)).status).toBe("up_to_date");
    const changed = decideHttpCheck(current, probe(200, '"v2"', null));
    expect(changed.status).toBe("unknown");
    expect(changed.reason).toBe("recurso-mudou");
  });

  test("sem metadados remotos nunca afirma update", () => {
    const current = item({ source: { ...emptySource(), kind: "direct-url", resolvedUrl: "https://example.com/App.dmg" } });
    const outcome = decideHttpCheck(current, probe(200, null, null));
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBe("sem-metadados");
  });

  test("404 e 5xx são reportados", () => {
    const current = item({ source: { ...emptySource(), kind: "direct-url", resolvedUrl: "https://example.com/App.dmg" } });
    expect(decideHttpCheck(current, probe(404, null, null)).status).toBe("not_found");
    expect(decideHttpCheck(current, probe(503, null, null)).status).toBe("error");
  });

  test("tamanho igual indica sem mudança", () => {
    const current = item({
      source: { ...emptySource(), kind: "direct-url", resolvedUrl: "https://example.com/App.dmg", size: 1234 },
    });
    expect(decideHttpCheck(current, probe(200, null, 1234)).status).toBe("up_to_date");
  });
});

describe("untrackableOutcome", () => {
  test("origem local exige --url", () => {
    const outcome = untrackableOutcome(item({ source: { ...emptySource(), kind: "local-file" } }));
    expect(outcome.status).toBe("unknown");
    expect(outcome.hint).toContain("--url");
  });
});
