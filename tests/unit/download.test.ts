import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { NetworkError, SecurityError } from "../../src/core/errors.ts";
import { downloadToFile, probeUrl } from "../../src/core/input/download.ts";
import { isPrivateAddress } from "../../src/core/input/resolve.ts";
import { cleanupDir, tempRoot } from "../helpers/fixtures.ts";

let server: ReturnType<typeof Bun.serve>;
let base = "";
let flakyHits = 0;
const policy = { allowHttp: true, allowPrivateNetwork: true };

const CONTENT = "conteudo-do-artefato";
const CONTENT_SHA256 = new Bun.CryptoHasher("sha256").update(CONTENT).digest("hex");

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const route = url.pathname;
      if (route === "/ok") {
        return new Response(CONTENT, {
          headers: {
            etag: '"abc"',
            "last-modified": "Wed, 01 Jan 2026 00:00:00 GMT",
            "content-type": "application/octet-stream",
          },
        });
      }
      if (route === "/redirect") {
        return new Response(null, { status: 302, headers: { location: `${base}/ok` } });
      }
      if (route === "/chain") {
        return new Response(null, { status: 301, headers: { location: `${base}/redirect` } });
      }
      if (route === "/flaky") {
        flakyHits += 1;
        if (flakyHits < 3) return new Response("calma", { status: 429, headers: { "retry-after": "1" } });
        return new Response(CONTENT);
      }
      if (route === "/missing") return new Response("nada", { status: 404 });
      if (route === "/big") return new Response("x".repeat(50_000));
      if (route === "/slow") {
        await Bun.sleep(400);
        return new Response("tarde");
      }
      if (route === "/head-405") {
        if (request.method === "HEAD") return new Response(null, { status: 405 });
        return new Response("x", { status: 206, headers: { etag: '"range"', "content-range": "bytes 0-0/1" } });
      }
      return new Response("rota desconhecida", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("downloadToFile", () => {
  test("baixa, calcula sha256 e guarda metadados", async () => {
    const dir = await tempRoot("dmngr-dl");
    try {
      const result = await downloadToFile({
        url: `${base}/ok`,
        destinationPath: join(dir, "app.dmg"),
        policy,
        maxBytes: 1_000_000,
      });
      expect(result.sha256).toBe(CONTENT_SHA256);
      expect(result.size).toBe(CONTENT.length);
      expect(result.etag).toBe('"abc"');
      expect(result.lastModified).toContain("2026");
      expect(await Bun.file(result.path).text()).toBe(CONTENT);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("segue redirects e registra a cadeia", async () => {
    const dir = await tempRoot("dmngr-dl-redirect");
    try {
      const result = await downloadToFile({
        url: `${base}/chain`,
        destinationPath: join(dir, "app.dmg"),
        policy,
        maxBytes: 1_000_000,
      });
      expect(result.redirects).toHaveLength(2);
      expect(result.finalUrl).toBe(`${base}/ok`);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("tenta de novo em 429 e respeita Retry-After", async () => {
    const dir = await tempRoot("dmngr-dl-flaky");
    try {
      flakyHits = 0;
      const result = await downloadToFile({
        url: `${base}/flaky`,
        destinationPath: join(dir, "app.dmg"),
        policy,
        maxBytes: 1_000_000,
        retries: 3,
      });
      expect(result.size).toBe(CONTENT.length);
      expect(flakyHits).toBe(3);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("404 vira erro de rede com status", async () => {
    const dir = await tempRoot("dmngr-dl-404");
    try {
      let captured: NetworkError | null = null;
      try {
        await downloadToFile({
          url: `${base}/missing`,
          destinationPath: join(dir, "app.dmg"),
          policy,
          maxBytes: 1000,
        });
      } catch (error) {
        captured = error as NetworkError;
      }
      expect(captured).toBeInstanceOf(NetworkError);
      expect((captured?.details as { status?: number }).status).toBe(404);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("exceder maxBytes aborta e remove o arquivo parcial", async () => {
    const dir = await tempRoot("dmngr-dl-big");
    try {
      const target = join(dir, "app.dmg");
      await expect(
        downloadToFile({ url: `${base}/big`, destinationPath: target, policy, maxBytes: 1024, retries: 0 }),
      ).rejects.toThrow(NetworkError);
      expect(await Bun.file(target).exists()).toBe(false);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("hash divergente bloqueia e remove o arquivo", async () => {
    const dir = await tempRoot("dmngr-dl-hash");
    try {
      const target = join(dir, "app.dmg");
      await expect(
        downloadToFile({
          url: `${base}/ok`,
          destinationPath: target,
          policy,
          maxBytes: 1_000_000,
          expectedSha256: "0".repeat(64),
          retries: 0,
        }),
      ).rejects.toThrow(SecurityError);
      expect(await Bun.file(target).exists()).toBe(false);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("timeout de conexão vira erro de rede", async () => {
    const dir = await tempRoot("dmngr-dl-slow");
    try {
      await expect(
        downloadToFile({
          url: `${base}/slow`,
          destinationPath: join(dir, "app.dmg"),
          policy,
          maxBytes: 1000,
          connectTimeoutMs: 100,
          retries: 0,
        }),
      ).rejects.toThrow(NetworkError);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("bloqueia destino privado sem opt-in", async () => {
    const dir = await tempRoot("dmngr-dl-ssrf");
    try {
      await expect(
        downloadToFile({
          url: `${base}/ok`,
          destinationPath: join(dir, "app.dmg"),
          policy: { allowHttp: true, allowPrivateNetwork: false },
          maxBytes: 1000,
          retries: 0,
        }),
      ).rejects.toThrow(SecurityError);
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe("probeUrl", () => {
  test("HEAD devolve metadados sem baixar", async () => {
    const probe = await probeUrl({ url: `${base}/ok`, policy });
    expect(probe.status).toBe(200);
    expect(probe.etag).toBe('"abc"');
    expect(probe.method).toBe("HEAD");
  });

  test("cai para GET com Range quando HEAD não é suportado", async () => {
    const probe = await probeUrl({ url: `${base}/head-405`, policy });
    expect(probe.method).toBe("GET");
    expect(probe.etag).toBe('"range"');
  });

  test("404 é reportado sem exceção", async () => {
    const probe = await probeUrl({ url: `${base}/missing`, policy });
    expect(probe.status).toBe(404);
  });
});

describe("proteção SSRF", () => {
  test("o servidor de teste é reconhecido como privado", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
  });
});
