import { describe, expect, test } from "bun:test";
import { createStyle } from "../../src/core/style.ts";
import { formatRiskNotice, type RiskNotice } from "../../src/core/ops/risk.ts";

describe("formatRiskNotice", () => {
  test("monta bloco com app, checagem, resultado e detalhes sem ANSI", () => {
    const notice: RiskNotice = {
      override: "integrity",
      headline: "assinatura inválida",
      app: "PhotoCraft",
      check: "integridade (codesign --verify --strict)",
      outcome: "falhou",
      rows: [
        { label: "autoridade", value: "Developer ID Application: Example" },
        { label: "team", value: "ABCD1234" },
        { label: "spctl", value: "aceito (notarizado)" },
      ],
      flatMessage: "flat",
    };
    const text = formatRiskNotice(notice, createStyle(false));
    expect(text).toContain("aviso: risco — assinatura inválida");
    expect(text).toContain("app");
    expect(text).toContain("PhotoCraft");
    expect(text).toContain("checagem");
    expect(text).toContain("codesign --verify --strict");
    expect(text).toContain("resultado");
    expect(text).toContain("falhou");
    expect(text).toContain("spctl");
    expect(text).toContain("aceito (notarizado)");
    expect(text).not.toMatch(/\x1b\[/);
  });

  test("aplica ANSI quando habilitado", () => {
    const notice: RiskNotice = {
      override: "integrity",
      headline: "assinatura inválida",
      app: "App",
      outcome: "falhou",
      flatMessage: "flat",
    };
    const text = formatRiskNotice(notice, createStyle(true));
    expect(text).toMatch(/\x1b\[33maviso:\x1b\[0m/);
    expect(text).toMatch(/\x1b\[31mfalhou\x1b\[0m/);
  });
});
