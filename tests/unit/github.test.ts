import { describe, expect, test } from "bun:test";
import { NetworkError } from "../../src/core/errors.ts";
import {
  GithubClient,
  classifyAssetPlatform,
  isInstallableAssetName,
  newestPublishedRelease,
  parseRelease,
  selectReleaseAsset,
  sha256FromDigest,
  type GithubRelease,
} from "../../src/core/providers/github.ts";

function makeAsset(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: 1,
    name,
    size: 1000,
    content_type: "application/octet-stream",
    browser_download_url: `https://github.com/acme/editor/releases/download/v1.0.0/${name}`,
    url: `https://api.github.com/repos/acme/editor/releases/assets/1`,
    updated_at: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

function makeRelease(names: string[], extra: Record<string, unknown> = {}): GithubRelease {
  return parseRelease({
    tag_name: "v1.0.0",
    name: "1.0.0",
    draft: false,
    prerelease: false,
    published_at: "2026-01-01T00:00:00Z",
    assets: names.map((name) => makeAsset(name)),
    ...extra,
  });
}

describe("parseRelease", () => {
  test("lê assets, digest e canais", () => {
    const release = parseRelease({
      tag_name: "v2.0.0",
      prerelease: true,
      assets: [makeAsset("Editor-arm64.dmg", { digest: `sha256:${"a".repeat(64)}` })],
    });
    expect(release.tag).toBe("v2.0.0");
    expect(release.prerelease).toBe(true);
    expect(release.assets[0]?.name).toBe("Editor-arm64.dmg");
    expect(sha256FromDigest(release.assets[0]?.digest ?? null)).toBe("a".repeat(64));
  });

  test("rejeita release sem tag", () => {
    expect(() => parseRelease({ assets: [] })).toThrow(NetworkError);
    expect(() => parseRelease("nada")).toThrow(NetworkError);
  });
});

describe("selectReleaseAsset", () => {
  test("reconhece extensões instaláveis", () => {
    expect(isInstallableAssetName("Editor-arm64.dmg")).toBe(true);
    expect(isInstallableAssetName("Editor.pkg")).toBe(true);
    expect(isInstallableAssetName("Editor.zip")).toBe(false);
    expect(isInstallableAssetName("checksums.txt")).toBe(false);
  });

  test("classifica plataforma pelo nome", () => {
    expect(classifyAssetPlatform("Editor-arm64.dmg")).toBe("mac");
    expect(classifyAssetPlatform("Editor-Setup.exe")).toBe("windows");
    expect(classifyAssetPlatform("Editor-x86_64.AppImage")).toBe("linux");
    expect(classifyAssetPlatform("Editor-windows-x64.dmg")).toBe("windows");
    expect(classifyAssetPlatform("Editor-macos-x64.pkg")).toBe("mac");
  });

  test("prefere o nome exato informado e o padrão salvo", () => {
    const release = makeRelease(["Editor-arm64.dmg", "Editor-x64.dmg"]);
    const byName = selectReleaseAsset(release, { assetName: "Editor-x64.dmg", machineArch: "arm64" });
    expect(byName !== null && "asset" in byName && byName.asset.name).toBe("Editor-x64.dmg");
    const byPattern = selectReleaseAsset(release, { savedPattern: "Editor-arm64.dmg", machineArch: "x64" });
    expect(byPattern !== null && "asset" in byPattern && byPattern.asset.name).toBe("Editor-arm64.dmg");
  });

  test("escolhe o asset da arquitetura da máquina", () => {
    const release = makeRelease(["Editor-arm64.dmg", "Editor-x64.dmg"]);
    const onArm = selectReleaseAsset(release, { machineArch: "arm64" });
    expect(onArm !== null && "asset" in onArm && onArm.asset.name).toBe("Editor-arm64.dmg");
    const onIntel = selectReleaseAsset(release, { machineArch: "x64" });
    expect(onIntel !== null && "asset" in onIntel && onIntel.asset.name).toBe("Editor-x64.dmg");
  });

  test("ignora assets de outras plataformas", () => {
    const release = makeRelease(["Editor-Setup.exe", "Editor-x86_64.AppImage", "Editor.dmg"]);
    const selection = selectReleaseAsset(release, { machineArch: "arm64" });
    expect(selection !== null && "asset" in selection && selection.asset.name).toBe("Editor.dmg");
    expect(selectReleaseAsset(makeRelease(["Editor-Setup.exe", "Editor.AppImage"]), { machineArch: "arm64" })).toBeNull();
  });

  test("app universal prefere asset sem token de arquitetura", () => {
    const release = makeRelease(["Editor.dmg", "Editor-arm64.dmg"]);
    const selection = selectReleaseAsset(release, { machineArch: "arm64", preferredArchs: ["x86_64", "arm64"] });
    expect(selection !== null && "asset" in selection && selection.asset.name).toBe("Editor.dmg");
  });

  test("x64 em Apple Silicon continua instalável (Rosetta), arm64 em Intel não", () => {
    const onlyX64 = makeRelease(["Editor-x64.dmg"]);
    const onArm = selectReleaseAsset(onlyX64, { machineArch: "arm64" });
    expect(onArm !== null && "asset" in onArm && onArm.asset.name).toBe("Editor-x64.dmg");
    expect(onArm !== null && "asset" in onArm && onArm.arch).toBe("x64");

    const onlyArm = makeRelease(["Editor-arm64.dmg"]);
    const onIntel = selectReleaseAsset(onlyArm, { machineArch: "x64" });
    expect(onIntel !== null && "incompatible" in onIntel).toBe(true);
    if (onIntel !== null && "incompatible" in onIntel) {
      expect(onIntel.machineArch).toBe("x64");
      expect(onIntel.candidates.map((asset) => asset.name)).toEqual(["Editor-arm64.dmg"]);
    }
  });

  test("nunca escolhe sozinho quando há vários compatíveis", () => {
    const release = makeRelease(["Editor-a.dmg", "Editor-b.dmg"]);
    const selection = selectReleaseAsset(release, { machineArch: "arm64" });
    expect(selection !== null && "ambiguous" in selection).toBe(true);
  });

  test("devolve null quando não há assets instaláveis", () => {
    expect(selectReleaseAsset(makeRelease(["codigo.tar.gz", "checksums.txt"]), { machineArch: "arm64" })).toBeNull();
  });
});

describe("releaseForChannel", () => {
  function clientWithReleases(releases: unknown[]): GithubClient {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        const latest = releases.find((entry) => (entry as { prerelease?: boolean }).prerelease !== true);
        if (latest === undefined) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify(latest), { status: 200 });
      }
      return new Response(JSON.stringify(releases), { status: 200 });
    }) as unknown as typeof fetch;
    return new GithubClient({ fetchImpl });
  }

  const stable = { tag_name: "v1.0.0", prerelease: false, published_at: "2026-01-01T00:00:00Z", assets: [makeAsset("App.dmg")] };
  const older = { tag_name: "v0.9.0", prerelease: false, published_at: "2025-12-01T00:00:00Z", assets: [makeAsset("App.dmg")] };
  const pre = { tag_name: "v2.0.0-beta.1", prerelease: true, published_at: "2026-02-01T00:00:00Z", assets: [makeAsset("App.dmg")] };
  const draft = { tag_name: "v3.0.0", draft: true, prerelease: false, published_at: "2026-03-01T00:00:00Z", assets: [makeAsset("App.dmg")] };

  test("stable usa releases/latest", async () => {
    const release = await clientWithReleases([pre, stable, older]).releaseForChannel("acme", "editor", "stable");
    expect(release.tag).toBe("v1.0.0");
  });

  test("prerelease usa a release publicada mais recente, ignorando rascunhos", async () => {
    const release = await clientWithReleases([draft, pre, stable, older]).releaseForChannel("acme", "editor", "prerelease");
    expect(release.tag).toBe("v2.0.0-beta.1");
    const withoutPre = await clientWithReleases([draft, stable, older]).releaseForChannel("acme", "editor", "prerelease");
    expect(withoutPre.tag).toBe("v1.0.0");
  });

  test("falha quando não há releases publicadas", async () => {
    await expect(clientWithReleases([draft]).releaseForChannel("acme", "editor", "prerelease")).rejects.toThrow(NetworkError);
  });

  test("newestPublishedRelease ordena por publicação", () => {
    expect(newestPublishedRelease([parseRelease(older), parseRelease(stable), parseRelease(pre)])?.tag).toBe("v2.0.0-beta.1");
    expect(newestPublishedRelease([parseRelease(draft)])).toBeNull();
  });
});

describe("GithubClient", () => {
  function clientWith(status: number, payload: unknown, headers: Record<string, string> = {}): GithubClient {
    const fetchImpl = (async () =>
      new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status, headers })) as unknown as typeof fetch;
    return new GithubClient({ fetchImpl });
  }

  test("lê a última release", async () => {
    const client = clientWith(200, { tag_name: "v1.0.0", assets: [makeAsset("Editor.dmg")] });
    const release = await client.latestRelease("acme", "editor");
    expect(release.tag).toBe("v1.0.0");
    expect(release.assets).toHaveLength(1);
  });

  test("404 indica repositório/release inexistente", async () => {
    const client = clientWith(404, { message: "Not Found" });
    const error = (await client.latestRelease("acme", "editor").catch((caught: unknown) => caught)) as NetworkError;
    expect(error).toBeInstanceOf(NetworkError);
    expect((error.details as { status?: number }).status).toBe(404);
  });

  test("403 com rate limit sugere GITHUB_TOKEN", async () => {
    const client = clientWith(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" });
    const error = (await client.latestRelease("acme", "editor").catch((caught: unknown) => caught)) as NetworkError;
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.hint).toContain("GITHUB_TOKEN");
    expect((error.details as { rateLimited?: boolean }).rateLimited).toBe(true);
  });

  test("5xx vira erro de rede", async () => {
    const client = clientWith(502, { message: "bad gateway" });
    await expect(client.latestRelease("acme", "editor")).rejects.toThrow(NetworkError);
  });
});
