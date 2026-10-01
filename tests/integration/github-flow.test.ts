import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { machineArch } from "../../src/core/system.ts";
import {
  cleanupDir,
  createAppBundle,
  createDmg,
  envFor,
  readJson,
  runCli,
  tempRoot,
} from "../helpers/fixtures.ts";

const integration = process.env.DMNGR_INTEGRATION === "1";
setDefaultTimeout(120_000);

interface RegistryFile {
  items: {
    id: string;
    installedVersion: string | null;
    source: { channel: string | null; pinnedTag: string | null; repository: string | null };
    artifact: { releaseTag: string | null };
  }[];
}

/**
 * Fluxo completo (instalação → registro → canal → pin) contra uma API do GitHub
 * simulada localmente. O binário de verdade é executado como subprocesso.
 */
describe.skipIf(!integration)("fluxo GitHub com API local", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve>;
  let apiBase = "";
  let requests: string[] = [];
  const machine = machineArch();
  const otherArch = machine === "arm64" ? "x64" : "arm64";
  const dmgBytes = new Map<string, Uint8Array>();

  function assetName(version: string, arch: string): string {
    return `GhDemo-${version}-${arch}.dmg`;
  }

  function releasePayload(version: string, tag: string, prerelease: boolean, assetNames: string[], publishedAt: string) {
    return {
      tag_name: tag,
      name: version,
      prerelease,
      published_at: publishedAt,
      assets: assetNames.map((name, index) => {
        const bytes = dmgBytes.get(name);
        return {
          id: index + 1,
          name,
          size: bytes?.byteLength ?? 0,
          content_type: "application/octet-stream",
          digest: null,
          browser_download_url: `${apiBase}/asset/${encodeURIComponent(name)}`,
          url: `${apiBase}/repos/acme/demo/releases/assets/${index + 1}`,
        };
      }),
    };
  }

  beforeAll(async () => {
    root = await tempRoot("dmngr-gh-flow");

    const buildDmg = async (version: string, arch: string, bundleVersion?: string): Promise<string> => {
      const dir = join(root, `src-${version}-${arch}`);
      await createAppBundle(dir, {
        name: "GhDemo",
        bundleId: "com.dmngr.ghdemo",
        displayName: "GhDemo",
        shortVersion: bundleVersion ?? version,
        buildVersion: "100",
      });
      const path = await createDmg(dir, join(root, `${assetName(version, arch)}`), "GhDemo");
      dmgBytes.set(assetName(version, arch), new Uint8Array(await Bun.file(path).arrayBuffer()));
      return path;
    };

    await buildDmg("1.0.0", machine);
    await buildDmg("1.1.0", machine);
    await buildDmg("2.0.0", machine, "2.0.0-beta.1");
    // Mesmo app sob um nome com a arquitetura "errada" (o nome é o que decide antes do download).
    await buildDmg("1.1.0", otherArch);

    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname);

        if (url.pathname === "/repos/acme/demo/releases/latest") {
          return Response.json(
            releasePayload("1.1.0", "v1.1.0", false, [assetName("1.1.0", machine)], "2026-01-10T00:00:00Z"),
          );
        }
        if (url.pathname === "/repos/acme/demo/releases") {
          return Response.json([
            releasePayload("2.0.0", "v2.0.0-beta.1", true, [assetName("2.0.0", machine)], "2026-02-01T00:00:00Z"),
            releasePayload("1.1.0", "v1.1.0", false, [assetName("1.1.0", machine)], "2026-01-10T00:00:00Z"),
            releasePayload("1.0.0", "v1.0.0", false, [assetName("1.0.0", machine)], "2026-01-01T00:00:00Z"),
          ]);
        }
        const tagMatch = /^\/repos\/acme\/demo\/releases\/tags\/(.+)$/.exec(url.pathname);
        if (tagMatch?.[1] !== undefined) {
          const tag = decodeURIComponent(tagMatch[1]);
          if (tag === "v1.0.0") {
            return Response.json(releasePayload("1.0.0", "v1.0.0", false, [assetName("1.0.0", machine)], "2026-01-01T00:00:00Z"));
          }
          if (tag === "v1.1.0") {
            return Response.json(releasePayload("1.1.0", "v1.1.0", false, [assetName("1.1.0", machine)], "2026-01-10T00:00:00Z"));
          }
          if (tag === "v1.0.0-outra") {
            return Response.json(
              releasePayload("1.0.0", "v1.0.0-outra", false, [assetName("1.1.0", otherArch)], "2026-01-01T00:00:00Z"),
            );
          }
          return new Response("{}", { status: 404 });
        }
        if (url.pathname.startsWith("/asset/")) {
          const name = decodeURIComponent(url.pathname.slice("/asset/".length));
          const bytes = dmgBytes.get(name);
          if (bytes === undefined) return new Response("não encontrado", { status: 404 });
          return new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
        }
        return new Response("não encontrado", { status: 404 });
      },
    });
    apiBase = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    await cleanupDir(root);
  });

  function stateFor(name: string): { state: string; dest: string } {
    return { state: join(root, `state-${name}`), dest: join(root, `dest-${name}`) };
  }

  function envForState(state: string): Record<string, string> {
    return envFor(state, { DMNGR_GITHUB_API_URL: apiBase });
  }

  const networkFlags = ["--allow-http", "--allow-private-network", "--allow-unverified"];

  test("URL antiga contra a cabeça do canal exige decisão (exit 3)", async () => {
    const { state, dest } = stateFor("decisao");
    const result = await runCli(
      [
        "install",
        "https://github.com/acme/demo/releases/download/v1.0.0/" + assetName("1.0.0", machine),
        "--destination",
        dest,
        "--yes",
        ...networkFlags,
      ],
      envForState(state),
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("v1.0.0");
    expect(result.stderr).toContain("v1.1.0");
    expect(result.stderr).toContain("--latest");
  });

  test("--latest instala a cabeça do canal e registra canal/release", async () => {
    const { state, dest } = stateFor("latest");
    const result = await runCli(
      [
        "install",
        "https://github.com/acme/demo/releases/download/v1.0.0/" + assetName("1.0.0", machine),
        "--destination",
        dest,
        "--latest",
        "--yes",
        "--json",
        ...networkFlags,
      ],
      envForState(state),
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string; installedVersion: string; source: { channel: string } };
    expect(payload.action).toBe("installed");
    expect(payload.installedVersion).toBe("1.1.0");
    expect(payload.source.channel).toBe("stable");

    const registry = (await readJson(join(state, "registry.json"))) as RegistryFile;
    expect(registry.items[0]?.artifact.releaseTag).toBe("v1.1.0");
    expect(registry.items[0]?.source.pinnedTag).toBeNull();
  });

  test("--pin mantém a versão da URL e o update recusa sair do pin", async () => {
    const { state, dest } = stateFor("pin");
    const pinned = await runCli(
      [
        "install",
        "https://github.com/acme/demo/releases/download/v1.0.0/" + assetName("1.0.0", machine),
        "--destination",
        dest,
        "--pin",
        "--yes",
        "--json",
        ...networkFlags,
      ],
      envForState(state),
    );
    expect(pinned.code).toBe(0);
    expect((JSON.parse(pinned.stdout) as { installedVersion: string }).installedVersion).toBe("1.0.0");

    const registry = (await readJson(join(state, "registry.json"))) as RegistryFile;
    expect(registry.items[0]?.source.pinnedTag).toBe("v1.0.0");

    const refused = await runCli(["update", "com.dmngr.ghdemo", "--yes", ...networkFlags], envForState(state));
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("--latest");

    const updated = await runCli(["update", "com.dmngr.ghdemo", "--latest", "--yes", "--json", ...networkFlags], envForState(state));
    expect(updated.code).toBe(0);
    const payload = JSON.parse(updated.stdout) as { action: string; installedVersion: string };
    expect(payload.action).toBe("updated");
    expect(payload.installedVersion).toBe("1.1.0");

    const after = (await readJson(join(state, "registry.json"))) as RegistryFile;
    expect(after.items[0]?.source.pinnedTag).toBeNull();
    expect(after.items[0]?.artifact.releaseTag).toBe("v1.1.0");
  });

  test("--prerelease usa a release publicada mais recente (inclui pré-lançamento)", async () => {
    const { state, dest } = stateFor("pre");
    const result = await runCli(
      ["install", "https://github.com/acme/demo", "--prerelease", "--destination", dest, "--yes", "--json", ...networkFlags],
      envForState(state),
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { installedVersion: string; source: { channel: string } };
    expect(payload.installedVersion).toBe("2.0.0-beta.1");
    expect(payload.source.channel).toBe("prerelease");
    expect(requests.filter((path) => path === "/repos/acme/demo/releases").length).toBeGreaterThan(0);
  });

  test("check segue o canal registrado e reporta up_to_date", async () => {
    const { state, dest } = stateFor("check");
    const installed = await runCli(
      ["install", "https://github.com/acme/demo", "--destination", dest, "--yes", "--quiet", ...networkFlags],
      envForState(state),
    );
    expect(installed.code).toBe(0);

    requests = [];
    const check = await runCli(["check", "--json"], envForState(state));
    expect(check.code).toBe(0);
    const payload = JSON.parse(check.stdout) as { items: { status: string; evidence: string; installedVersion: string }[] };
    expect(payload.items[0]?.status).toBe("up_to_date");
    expect(payload.items[0]?.installedVersion).toBe("1.1.0");
    expect(requests).toContain("/repos/acme/demo/releases/latest");
  });

  test("arquitetura incompatível bloqueia antes do download (arm64 em Intel) ou pede aceite (x64 em Apple Silicon)", async () => {
    const { state, dest } = stateFor("arch");
    const url = "https://github.com/acme/demo/releases/download/v1.0.0-outra/" + assetName("1.1.0", otherArch);

    // Sem nenhum aceite: em Intel o arm64 é impossível; em Apple Silicon o x64 exige aceite.
    const withoutAcceptance = await runCli(
      ["install", url, "--destination", dest, "--pin", "--yes", "--allow-http", "--allow-private-network"],
      envForState(state),
    );
    if (machine === "x64") {
      expect(withoutAcceptance.code).toBe(6);
      expect(withoutAcceptance.stderr).toContain("arm64");
    } else {
      expect(withoutAcceptance.code).toBe(5);
      expect(withoutAcceptance.stderr).toContain("Rosetta");
      expect(withoutAcceptance.stderr).toContain("--allow-arch-mismatch");
    }

    // --allow-arch-mismatch é a flag específica (em Intel continua bloqueado).
    const precise = await runCli(
      ["install", url, "--destination", join(dest, "precise"), "--pin", "--yes", "--allow-arch-mismatch", "--allow-http", "--allow-private-network", "--allow-unverified"],
      envForState(join(state, "precise")),
    );

    if (machine === "arm64") {
      expect(precise.code).toBe(0);
      const registry = (await readJson(join(state, "precise", "registry.json"))) as {
        items: { verification: { overrides: string[] } }[];
      };
      expect(registry.items[0]?.verification.overrides).toContain("arch-mismatch");
    } else {
      // Intel continua bloqueado: arm64 não roda de forma alguma
      expect(precise.code).toBe(6);
    }
  });

  test("repo inexistente na API vira erro de rede sem tocar no sistema", async () => {
    const { state, dest } = stateFor("404");
    const result = await runCli(
      ["install", "https://github.com/acme/nao-existe", "--destination", dest, "--yes", ...networkFlags],
      envForState(state),
    );
    expect(result.code).toBe(4);
    expect(await Bun.file(join(state, "registry.json")).exists()).toBe(false);
  });
});
