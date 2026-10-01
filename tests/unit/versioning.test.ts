import { describe, expect, test } from "bun:test";
import {
  compareVersions,
  isNewerVersion,
  looksLikeVersion,
  normalizeTag,
  parseVersion,
  tagMapsToVersion,
} from "../../src/core/versioning.ts";

describe("parseVersion", () => {
  test("aceita versões numéricas comuns", () => {
    expect(parseVersion("1.2.3")).toEqual({ core: [1, 2, 3], pre: null, raw: "1.2.3" });
    expect(parseVersion(" v2.0 ")).toEqual({ core: [2, 0], pre: null, raw: " v2.0 " });
    expect(parseVersion("1")).toEqual({ core: [1], pre: null, raw: "1" });
  });

  test("separa pré-lançamento e ignora metadados de build", () => {
    expect(parseVersion("1.2.3-beta.1")?.pre).toEqual(["beta", "1"]);
    expect(parseVersion("1.2.3+build.5")?.pre).toBeNull();
    expect(parseVersion("1.2.3-rc.1+exp")?.pre).toEqual(["rc", "1"]);
  });

  test("rejeita o que não é versão", () => {
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("1.2.x")).toBeNull();
    expect(parseVersion("")).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion("1.2.3-")).toBeNull();
  });
});

describe("compareVersions", () => {
  test("compara com preenchimento de zeros", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
    expect(compareVersions("1.10", "1.9")).toBe(1);
  });

  test("pré-lançamentos são menores que a versão final", () => {
    expect(compareVersions("1.0.0-beta", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-alpha.1")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.1", "1.0.0-beta")).toBe(-1);
    expect(compareVersions("1.0.0-alpha.10", "1.0.0-alpha.2")).toBe(1);
  });

  test("devolve null quando não é comparável", () => {
    expect(compareVersions("abc", "1.0.0")).toBeNull();
    expect(compareVersions(null, "1.0.0")).toBeNull();
    expect(compareVersions("1.0.0", undefined)).toBeNull();
  });
});

describe("tags", () => {
  test("normalizeTag remove o prefixo v apenas quando é versão", () => {
    expect(normalizeTag("v1.2.3")).toBe("1.2.3");
    expect(normalizeTag("1.2.3")).toBe("1.2.3");
    expect(normalizeTag("release-1.2.3")).toBeNull();
    expect(normalizeTag("latest")).toBeNull();
  });

  test("tagMapsToVersion exige igualdade normalizada", () => {
    expect(tagMapsToVersion("v1.2.3", "1.2.3")).toBe(true);
    expect(tagMapsToVersion("v1.2.4", "1.2.3")).toBe(false);
    expect(tagMapsToVersion("nightly", "1.2.3")).toBe(false);
    expect(tagMapsToVersion("1.2.3", null)).toBe(false);
  });

  test("isNewerVersion e looksLikeVersion", () => {
    expect(isNewerVersion("2.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0", "1.0")).toBe(false);
    expect(looksLikeVersion("1.2.3")).toBe(true);
    expect(looksLikeVersion("qualquer")).toBe(false);
  });
});
