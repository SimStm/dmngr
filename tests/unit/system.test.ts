import { describe, expect, test } from "bun:test";
import {
  archCompatibility,
  archsCompatibility,
  classifyArchList,
  classifyArchName,
  describeAssetArch,
  humanArch,
  machineArch,
  machineArchTokenPairs,
  resetSystemCache,
  rosettaAvailable,
} from "../../src/core/system.ts";

describe("machineArch", () => {
  test("acompanha process.arch", () => {
    expect(machineArch()).toBe(process.arch === "arm64" ? "arm64" : "x64");
    expect(humanArch("arm64")).toContain("Apple Silicon");
    expect(humanArch("x64")).toContain("Intel");
  });
});

describe("classifyArchName", () => {
  test("identifica arm64", () => {
    for (const name of ["App-arm64.dmg", "App_aarch64.pkg", "App-apple-silicon.dmg", "App-m1.dmg", "App-silicon.dmg"]) {
      expect(classifyArchName(name)).toBe("arm64");
    }
  });

  test("identifica x64", () => {
    for (const name of ["App-x64.dmg", "App-x86_64.dmg", "App-amd64.pkg", "App-intel.dmg"]) {
      expect(classifyArchName(name)).toBe("x64");
    }
  });

  test("identifica universal quando há as duas ou token universal", () => {
    expect(classifyArchName("App-universal.dmg")).toBe("universal");
    expect(classifyArchName("App-univ.dmg")).toBe("universal");
    expect(classifyArchName("App-arm64-x64.dmg")).toBe("universal");
    expect(classifyArchName("App-arm64-universal.dmg")).toBe("universal");
  });

  test("devolve unknown sem token de arquitetura", () => {
    expect(classifyArchName("Stats.dmg")).toBe("unknown");
    expect(classifyArchName("Editor.pkg")).toBe("unknown");
  });

  test("não confunde tokens dentro de palavras", () => {
    expect(classifyArchName("Marmalade.dmg")).toBe("unknown");
    expect(classifyArchName("X64bit.dmg")).toBe("unknown");
  });
});

describe("classifyArchList", () => {
  test("lê a saída do lipo", () => {
    expect(classifyArchList(["arm64"])).toBe("arm64");
    expect(classifyArchList(["x86_64"])).toBe("x64");
    expect(classifyArchList(["x86_64", "arm64"])).toBe("universal");
    expect(classifyArchList(["arm64e"])).toBe("arm64");
    expect(classifyArchList([])).toBe("unknown");
    expect(classifyArchList(null)).toBe("unknown");
    expect(classifyArchList(["ppc"])).toBe("unknown");
  });
});

describe("archCompatibility", () => {
  test("matriz completa", () => {
    expect(archCompatibility("arm64", "arm64")).toBe("ok");
    expect(archCompatibility("x64", "x64")).toBe("ok");
    expect(archCompatibility("universal", "arm64")).toBe("ok");
    expect(archCompatibility("universal", "x64")).toBe("ok");
    expect(archCompatibility("unknown", "arm64")).toBe("unknown");
    expect(archCompatibility("unknown", "x64")).toBe("unknown");
    expect(archCompatibility("x64", "arm64")).toBe("needs-rosetta");
    expect(archCompatibility("arm64", "x64")).toBe("impossible");
  });

  test("archsCompatibility usa as arquiteturas reais do bundle", () => {
    expect(archsCompatibility(["x86_64", "arm64"], "arm64")).toBe("ok");
    expect(archsCompatibility(["x86_64"], "arm64")).toBe("needs-rosetta");
    expect(archsCompatibility(["arm64"], "x64")).toBe("impossible");
    expect(archsCompatibility(null, "arm64")).toBe("unknown");
  });

  test("pares por máquina e descrição", () => {
    expect(machineArchTokenPairs("arm64")).toEqual({ preferred: "arm64", other: "x64" });
    expect(machineArchTokenPairs("x64")).toEqual({ preferred: "x64", other: "arm64" });
    expect(describeAssetArch("unknown")).toContain("não identificada");
  });
});

describe("rosettaAvailable", () => {
  test("é verdadeiro em Intel e responde em arm64", async () => {
    resetSystemCache();
    const available = await rosettaAvailable();
    if (machineArch() === "x64") expect(available).toBe(true);
    else expect(typeof available).toBe("boolean");
  });
});
