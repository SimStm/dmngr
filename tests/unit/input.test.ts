import { describe, expect, test } from "bun:test";
import { SecurityError, UsageError } from "../../src/core/errors.ts";
import {
  assertUrlAllowed,
  classifyInput,
  hasSensitiveQuery,
  isPrivateAddress,
  isPrivateHostname,
  parseGithubUrl,
  redactUrl,
} from "../../src/core/input/resolve.ts";
import { detectFormat } from "../../src/core/input/format.ts";
import { cleanupDir, tempRoot } from "../helpers/fixtures.ts";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

describe("classifyInput", () => {
  test("aceita https e caminhos existentes", async () => {
    const dir = await tempRoot("dmngr-input");
    try {
      const file = join(dir, "App.dmg");
      await writeFile(file, "x");
      const url = await classifyInput("https://example.com/App.dmg?download=1");
      expect(url.kind).toBe("url");
      expect(url.github).toBeNull();
      const local = await classifyInput(file);
      expect(local.kind).toBe("file");
      expect(local.filePath).toBe(file);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("rejeita entrada vazia, esquemas e arquivos inexistentes", async () => {
    await expect(classifyInput("")).rejects.toThrow(UsageError);
    await expect(classifyInput("ftp://example.com/x.dmg")).rejects.toThrow(UsageError);
    await expect(classifyInput("file:///tmp/x.dmg")).rejects.toThrow(UsageError);
    await expect(classifyInput("/caminho/que/nao/existe.dmg")).rejects.toThrow(UsageError);
  });
});

describe("parseGithubUrl", () => {
  test("reconhece assets de release (tag fixada e canal)", () => {
    const direct = parseGithubUrl(new URL("https://github.com/acme/editor/releases/download/v1.2.3/Editor-arm64.dmg"));
    expect(direct).toEqual({ owner: "acme", repo: "editor", tag: "v1.2.3", asset: "Editor-arm64.dmg", origin: "asset" });

    const latest = parseGithubUrl(new URL("https://github.com/acme/editor/releases/latest/download/Editor.dmg"));
    expect(latest).toEqual({ owner: "acme", repo: "editor", tag: null, asset: "Editor.dmg", origin: "asset" });

    const api = parseGithubUrl(new URL("https://api.github.com/repos/acme/editor/releases/latest"));
    expect(api).toEqual({ owner: "acme", repo: "editor", tag: null, asset: null, origin: "api" });

    const apiTag = parseGithubUrl(new URL("https://api.github.com/repos/acme/editor/releases/tags/v9"));
    expect(apiTag).toEqual({ owner: "acme", repo: "editor", tag: "v9", asset: null, origin: "api" });
  });

  test("reconhece páginas do repositório, de releases e de tag", () => {
    expect(parseGithubUrl(new URL("https://github.com/acme/editor"))).toEqual({
      owner: "acme",
      repo: "editor",
      tag: null,
      asset: null,
      origin: "repo",
    });
    expect(parseGithubUrl(new URL("https://github.com/acme/editor/releases"))?.origin).toBe("releases");
    expect(parseGithubUrl(new URL("https://github.com/acme/editor/releases/latest"))?.origin).toBe("latest");
    expect(parseGithubUrl(new URL("https://github.com/acme/editor/releases/tag/v1.2.3"))).toEqual({
      owner: "acme",
      repo: "editor",
      tag: "v1.2.3",
      asset: null,
      origin: "tag",
    });
  });

  test("rejeita código-fonte, seções que nunca instalam e API sem suporte", () => {
    expect(() => parseGithubUrl(new URL("https://github.com/acme/editor/archive/refs/tags/v1.2.3.tar.gz"))).toThrow(UsageError);
    expect(() => parseGithubUrl(new URL("https://github.com/acme/editor/tree/main"))).toThrow(UsageError);
    expect(() => parseGithubUrl(new URL("https://github.com/acme/editor/issues/12"))).toThrow(UsageError);
    expect(() => parseGithubUrl(new URL("https://github.com/acme/editor/releases/expanded_assets/v1"))).toThrow(UsageError);
    expect(() => parseGithubUrl(new URL("https://api.github.com/repos/acme/editor/releases/12345"))).toThrow(UsageError);
    expect(() => parseGithubUrl(new URL("https://api.github.com/repos/acme/editor/releases/assets/9"))).toThrow(UsageError);
    expect(parseGithubUrl(new URL("https://github.com/settings/profile"))).toBeNull();
    expect(parseGithubUrl(new URL("https://github.com/marketplace/actions/checkout"))).toBeNull();
    expect(parseGithubUrl(new URL("https://example.com/acme/editor/releases/download/x/y.dmg"))).toBeNull();
  });
});

describe("redação de URLs", () => {
  test("remove credenciais e valores sensíveis", () => {
    const url = "https://user:pass@example.com/App.dmg?X-Amz-Signature=abc123&token=zzz&page=2";
    const redacted = redactUrl(url);
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("zzz");
    expect(redacted).not.toContain("pass");
    expect(redacted).toContain("page=2");
    expect(hasSensitiveQuery(url)).toBe(true);
    expect(hasSensitiveQuery("https://example.com/App.dmg?page=2")).toBe(false);
  });
});

describe("proteção de rede (SSRF)", () => {
  test("classifica endereços privados", () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "172.16.9.9", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "fd00::1"]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
    for (const address of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  test("classifica hostnames internos", () => {
    expect(isPrivateHostname("localhost")).toBe(true);
    expect(isPrivateHostname("nas.local")).toBe(true);
    expect(isPrivateHostname("servico")).toBe(true);
    expect(isPrivateHostname("example.com")).toBe(false);
  });

  test("bloqueia http, IP privado e libera com opt-in", async () => {
    await expect(assertUrlAllowed("http://example.com/x", { allowHttp: false, allowPrivateNetwork: false })).rejects.toThrow(
      SecurityError,
    );
    await expect(assertUrlAllowed("https://127.0.0.1/x.dmg", { allowHttp: false, allowPrivateNetwork: false })).rejects.toThrow(
      SecurityError,
    );
    const allowed = await assertUrlAllowed("https://127.0.0.1/x.dmg", { allowHttp: false, allowPrivateNetwork: true });
    expect(allowed.hostname).toBe("127.0.0.1");
    const publicIp = await assertUrlAllowed("https://93.184.216.34/x.dmg", { allowHttp: false, allowPrivateNetwork: false });
    expect(publicIp.hostname).toBe("93.184.216.34");
  });
});

describe("detectFormat", () => {
  test("reconhece DMG, XAR, ZIP e bundle de pkg", async () => {
    const dir = await tempRoot("dmngr-format");
    try {
      const dmg = join(dir, "fake.dmg");
      const buffer = new Uint8Array(1024);
      buffer.set([0x6b, 0x6f, 0x6c, 0x79], 1024 - 512); // "koly" no trailer
      await writeFile(dmg, buffer);
      expect((await detectFormat(dmg)).format).toBe("dmg");

      const xar = join(dir, "fake.pkg");
      await writeFile(xar, Buffer.concat([Buffer.from("xar!"), Buffer.alloc(600)]));
      expect((await detectFormat(xar)).format).toBe("pkg-flat");

      const zip = join(dir, "fake.zip");
      await writeFile(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
      expect((await detectFormat(zip)).format).toBe("zip");

      const unknown = join(dir, "fake.bin");
      await writeFile(unknown, "conteúdo qualquer");
      expect((await detectFormat(unknown)).format).toBe("unknown");

      const bundle = join(dir, "Bundle.pkg");
      await mkdir(join(bundle, "Contents"), { recursive: true });
      await writeFile(join(bundle, "Contents", "Archive.bom"), "bom");
      expect((await detectFormat(bundle)).format).toBe("pkg-bundle");
    } finally {
      await cleanupDir(dir);
    }
  });
});
