import { describe, expect, test } from "bun:test";
import { AmbiguityError, InstallError, UsageError } from "../../src/core/errors.ts";
import { classifyInput } from "../../src/core/input/resolve.ts";
import { defaultConfig } from "../../src/core/config.ts";
import { defaultOperationOptions, type Ctx } from "../../src/core/ops/context.ts";
import {
  assetArchConcern,
  channelDecisionHint,
  channelDecisionMessage,
  resolveSourceForInput,
  stripQuery,
} from "../../src/core/ops/source.ts";
import { GithubClient, type GithubAsset } from "../../src/core/providers/github.ts";

interface FakeAsset {
  name: string;
  digest?: string | null;
}

function releasePayload(tag: string, assets: FakeAsset[], prerelease = false) {
  return {
    tag_name: tag,
    prerelease,
    published_at: "2026-01-01T00:00:00Z",
    assets: assets.map((asset, index) => ({
      id: index + 1,
      name: asset.name,
      size: 1000 + index,
      digest: asset.digest ?? null,
      browser_download_url: `https://github.com/acme/editor/releases/download/${tag}/${asset.name}`,
      url: `https://api.github.com/repos/acme/editor/releases/assets/${index + 1}`,
    })),
  };
}

interface FakeServerOptions {
  stable: string;
  stableAssets: FakeAsset[];
  head?: string;
  headAssets?: FakeAsset[];
  headPrerelease?: boolean;
  pinnedTag?: string;
  pinnedAssets?: FakeAsset[];
}

function fakeCtx(options: FakeServerOptions, opts: Partial<ReturnType<typeof defaultOperationOptions>> = {}): Ctx {
  const head = options.head ?? options.stable;
  const headAssets = options.headAssets ?? options.stableAssets;
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/releases/latest")) {
      return Response.json(releasePayload(options.stable, options.stableAssets));
    }
    if (url.includes("/releases?per_page=")) {
      return Response.json([releasePayload(head, headAssets, options.headPrerelease ?? false)]);
    }
    const tagMatch = /\/releases\/tags\/(.+)$/.exec(url);
    if (tagMatch?.[1] !== undefined) {
      const tag = decodeURIComponent(tagMatch[1]);
      if (tag === options.pinnedTag) {
        return Response.json(releasePayload(tag, options.pinnedAssets ?? options.stableAssets));
      }
      return new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;

  return {
    config: defaultConfig(),
    opts: { ...defaultOperationOptions(), ...opts },
    github: new GithubClient({ baseUrl: "https://api.github.com", fetchImpl }),
  };
}

describe("resolveSourceForInput com canal e pin", () => {
  const options = {
    machineArch: "arm64" as const,
    channel: "stable" as const,
    pin: false,
    latest: false,
  };

  test("URL fixada igual à cabeça do canal não pergunta nada", async () => {
    const ctx = fakeCtx({ stable: "v1.0.0", stableAssets: [{ name: "Editor-arm64.dmg" }] });
    const input = await classifyInput("https://github.com/acme/editor/releases/download/v1.0.0/Editor-arm64.dmg");
    const resolved = await resolveSourceForInput(ctx, input, options);
    expect(resolved.releaseTag).toBe("v1.0.0");
    expect(resolved.pinnedTag).toBeNull();
    expect(resolved.headTag).toBe("v1.0.0");
    expect(resolved.assetName).toBe("Editor-arm64.dmg");
  });

  test("URL antiga x cabeça do canal: sem flags, exige decisão", async () => {
    const ctx = fakeCtx({
      stable: "v1.1.0",
      stableAssets: [{ name: "Editor-arm64.dmg" }],
      pinnedTag: "v1.0.0",
      pinnedAssets: [{ name: "Editor-arm64.dmg" }],
    });
    const input = await classifyInput("https://github.com/acme/editor/releases/download/v1.0.0/Editor-arm64.dmg");
    let captured: AmbiguityError | null = null;
    try {
      await resolveSourceForInput(ctx, input, options);
    } catch (error) {
      captured = error as AmbiguityError;
    }
    expect(captured).toBeInstanceOf(AmbiguityError);
    expect(captured?.message).toContain("v1.0.0");
    expect(captured?.message).toContain("v1.1.0");
    expect(captured?.hint).toContain("--pin");
    expect(captured?.hint).toContain("--latest");
  });

  test("--pin mantém a versão da URL e registra a fixação", async () => {
    const ctx = fakeCtx({
      stable: "v1.1.0",
      stableAssets: [{ name: "Editor-arm64.dmg" }],
      pinnedTag: "v1.0.0",
      pinnedAssets: [{ name: "Editor-arm64.dmg" }],
    });
    const input = await classifyInput("https://github.com/acme/editor/releases/download/v1.0.0/Editor-arm64.dmg");
    const resolved = await resolveSourceForInput(ctx, input, { ...options, pin: true });
    expect(resolved.releaseTag).toBe("v1.0.0");
    expect(resolved.pinnedTag).toBe("v1.0.0");
    expect(resolved.headTag).toBe("v1.1.0");
    expect(resolved.source.pinnedTag).toBe("v1.0.0");
  });

  test("--latest segue a cabeça do canal", async () => {
    const ctx = fakeCtx({
      stable: "v1.1.0",
      stableAssets: [{ name: "Editor-arm64.dmg" }],
      pinnedTag: "v1.0.0",
      pinnedAssets: [{ name: "Editor-arm64.dmg" }],
    });
    const input = await classifyInput("https://github.com/acme/editor/releases/download/v1.0.0/Editor-arm64.dmg");
    const resolved = await resolveSourceForInput(ctx, input, { ...options, latest: true });
    expect(resolved.releaseTag).toBe("v1.1.0");
    expect(resolved.pinnedTag).toBeNull();
  });

  test("--prerelease usa a release publicada mais recente e registra o canal", async () => {
    const ctx = fakeCtx({
      stable: "v1.1.0",
      stableAssets: [{ name: "Editor-arm64.dmg" }],
      head: "v2.0.0-beta.1",
      headAssets: [{ name: "Editor-arm64.dmg" }],
      headPrerelease: true,
    });
    const input = await classifyInput("https://github.com/acme/editor");
    const resolved = await resolveSourceForInput(ctx, input, { ...options, channel: "prerelease" });
    expect(resolved.releaseTag).toBe("v2.0.0-beta.1");
    expect(resolved.channel).toBe("prerelease");
    expect(resolved.source.channel).toBe("prerelease");
  });

  test("escolhe o asset pela arquitetura da máquina", async () => {
    const ctx = fakeCtx({
      stable: "v1.0.0",
      stableAssets: [{ name: "Editor-arm64.dmg" }, { name: "Editor-x64.dmg" }],
    });
    const input = await classifyInput("https://github.com/acme/editor");
    const resolved = await resolveSourceForInput(ctx, input, options);
    expect(resolved.assetName).toBe("Editor-arm64.dmg");
    expect(resolved.archConcern).toBeNull();
  });

  test("x64 em Apple Silicon gera preocupação de arquitetura; digest é propagado", async () => {
    const digest = "a".repeat(64);
    const ctx = fakeCtx({ stable: "v1.0.0", stableAssets: [{ name: "Editor-x64.dmg", digest: `sha256:${digest}` }] });
    const input = await classifyInput("https://github.com/acme/editor");
    const resolved = await resolveSourceForInput(ctx, input, options);
    expect(resolved.assetName).toBe("Editor-x64.dmg");
    expect(resolved.archConcern?.kind).toBe("needs-rosetta");
    expect(resolved.expectedSha256).toBe(digest);
  });

  test("sem build compatível com a máquina falha com os candidatos", async () => {
    const ctx = fakeCtx({ stable: "v1.0.0", stableAssets: [{ name: "Editor-arm64.dmg" }] });
    const input = await classifyInput("https://github.com/acme/editor");
    let captured: unknown = null;
    try {
      await resolveSourceForInput(ctx, input, { ...options, machineArch: "x64" });
    } catch (caught) {
      captured = caught;
    }
    expect(captured).toBeInstanceOf(InstallError);
    const installError = captured as InstallError;
    expect(installError.message).toContain("x64");
    expect((installError.details as { assetsIncompativeis?: string[] }).assetsIncompativeis).toEqual(["Editor-arm64.dmg"]);
  });

  test("release sem assets macOS falha com a lista", async () => {
    const ctx = fakeCtx({ stable: "v1.0.0", stableAssets: [{ name: "Editor-Setup.exe" }] });
    const input = await classifyInput("https://github.com/acme/editor");
    await expect(resolveSourceForInput(ctx, input, options)).rejects.toThrow(InstallError);
  });

  test("--pin exige uma URL que fixe versão; --pin + --latest é erro de uso", async () => {
    const ctx = fakeCtx({ stable: "v1.0.0", stableAssets: [{ name: "Editor-arm64.dmg" }] });
    const page = await classifyInput("https://github.com/acme/editor");
    await expect(resolveSourceForInput(ctx, page, { ...options, pin: true })).rejects.toThrow(UsageError);
    const asset = await classifyInput("https://github.com/acme/editor/releases/download/v1.0.0/Editor-arm64.dmg");
    await expect(resolveSourceForInput(ctx, asset, { ...options, pin: true, latest: true })).rejects.toThrow(UsageError);
  });
});

describe("helpers de canal e arquitetura", () => {
  test("mensagem e dica da decisão de canal", () => {
    const info = {
      owner: "acme",
      repo: "editor",
      channel: "stable" as const,
      pinnedTag: "v1.0.0",
      headTag: "v1.1.0",
      pinnedVersion: "1.0.0",
      headVersion: "1.1.0",
      pinnedIsNewer: false,
    };
    expect(channelDecisionMessage(info)).toContain("v1.0.0");
    expect(channelDecisionMessage(info)).toContain("v1.1.0");
    expect(channelDecisionHint()).toContain("--pin");
    expect(channelDecisionHint()).toContain("--latest");
  });

  test("assetArchConcern cobre rosetta, desconhecida e nativa", () => {
    const asset = (name: string): GithubAsset => ({
      id: 1,
      name,
      size: null,
      contentType: null,
      digest: null,
      browserDownloadUrl: "https://example.com/x",
      apiUrl: "https://api.github.com/x",
      updatedAt: null,
    });
    expect(assetArchConcern(asset("App-x64.dmg"), "arm64")?.kind).toBe("needs-rosetta");
    expect(assetArchConcern(asset("App-arm64.dmg"), "arm64")).toBeNull();
    expect(assetArchConcern(asset("Stats.dmg"), "arm64")?.kind).toBe("unknown");
    expect(assetArchConcern(asset("App-universal.dmg"), "arm64")).toBeNull();
  });

  test("stripQuery remove credenciais e query", () => {
    expect(stripQuery("https://example.com/App.dmg?X-Amz-Signature=abc")).toBe("https://example.com/App.dmg");
  });
});
