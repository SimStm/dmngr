import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { installAppBundle, stagingArtifacts, uniqueAppName } from "../../src/core/install/app-swap.ts";
import { InstallError } from "../../src/core/errors.ts";
import { archsOf, buildRegistryItem, formatArch, sameArchs, slugify } from "../../src/core/ops/item.ts";
import { emptyArtifact, emptySource, emptyVerification, type RegistryItem } from "../../src/core/registry/schema.ts";
import { cleanupDir, createAppBundle, tempRoot } from "../helpers/fixtures.ts";

describe("installAppBundle", () => {
  test("instala um app novo sem backup", async () => {
    const dir = await tempRoot("dmngr-swap");
    try {
      const source = await createAppBundle(join(dir, "origem"), { name: "Novo" });
      const dest = join(dir, "destino");
      await mkdir(dest, { recursive: true });
      const result = await installAppBundle({ source, destinationDir: dest });
      expect(result.hadPrevious).toBe(false);
      expect(await Bun.file(join(result.installedPath, "Contents", "Info.plist")).exists()).toBe(true);
      expect(await stagingArtifacts(dest)).toEqual([]);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("substitui mantendo backup temporário limpo e remove o antigo", async () => {
    const dir = await tempRoot("dmngr-swap-replace");
    try {
      const dest = join(dir, "destino");
      await mkdir(dest, { recursive: true });
      const first = await createAppBundle(join(dir, "v1"), { name: "App", shortVersion: "1.0.0" });
      const second = await createAppBundle(join(dir, "v2"), { name: "App", shortVersion: "2.0.0" });
      await installAppBundle({ source: first, destinationDir: dest });
      const result = await installAppBundle({ source: second, destinationDir: dest });
      expect(result.hadPrevious).toBe(true);
      const plist = await readFile(join(result.installedPath, "Contents", "Info.plist"), "utf8");
      expect(plist).toContain("2.0.0");
      expect(await stagingArtifacts(dest)).toEqual([]);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("falha na verificação preserva o app anterior", async () => {
    const dir = await tempRoot("dmngr-swap-fail");
    try {
      const dest = join(dir, "destino");
      await mkdir(dest, { recursive: true });
      const first = await createAppBundle(join(dir, "v1"), { name: "App", shortVersion: "1.0.0" });
      await installAppBundle({ source: first, destinationDir: dest });
      const second = await createAppBundle(join(dir, "v2"), { name: "App", shortVersion: "2.0.0" });
      await expect(
        installAppBundle({
          source: second,
          destinationDir: dest,
          beforeCommit: async () => {
            throw new InstallError("verificação falhou de propósito");
          },
        }),
      ).rejects.toThrow(InstallError);
      const plist = await readFile(join(dest, "App.app", "Contents", "Info.plist"), "utf8");
      expect(plist).toContain("1.0.0");
      expect(await stagingArtifacts(dest)).toEqual([]);
    } finally {
      await cleanupDir(dir);
    }
  });

  test("rejeita origem que não é .app e destino sem permissão", async () => {
    const dir = await tempRoot("dmngr-swap-bad");
    try {
      await expect(
        installAppBundle({ source: join(dir, "arquivo.txt"), destinationDir: dir }),
      ).rejects.toThrow(InstallError);

      const source = await createAppBundle(join(dir, "src"), { name: "Bloqueado" });
      const readonly = join(dir, "readonly");
      await mkdir(readonly, { recursive: true });
      await chmod(readonly, 0o500);
      try {
        await expect(installAppBundle({ source, destinationDir: readonly })).rejects.toThrow(InstallError);
      } finally {
        await chmod(readonly, 0o700);
      }
    } finally {
      await cleanupDir(dir);
    }
  });

  test("uniqueAppName gera nomes livres", async () => {
    const dir = await tempRoot("dmngr-unique");
    try {
      expect(await uniqueAppName(dir, "App.app")).toBe("App 2.app");
      await writeFile(join(dir, "App 2.app"), "x");
      expect(await uniqueAppName(dir, "App.app")).toBe("App 3.app");
    } finally {
      await cleanupDir(dir);
    }
  });
});

describe("helpers de item", () => {
  function base(overrides: Partial<RegistryItem> = {}): RegistryItem {
    return {
      id: "com.example.app",
      displayName: "Example",
      aliases: ["Antigo"],
      kind: "app",
      artifactType: "dmg",
      bundleId: "com.example.app",
      installedPath: "/Applications/Example.app",
      installedVersion: "1.0.0",
      buildVersion: "100",
      versionEvidence: "bundle-info-plist",
      arch: "arm64",
      weakIdentity: false,
      source: emptySource(),
      artifact: emptyArtifact(),
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

  test("buildRegistryItem preserva installedAt, mescla aliases e registra versão anterior", () => {
    const existing = base();
    const built = buildRegistryItem(
      {
        kind: "app",
        artifactType: "dmg",
        baseId: "com.example.app",
        displayName: "Example",
        aliases: ["Novo"],
        bundleId: "com.example.app",
        installedPath: "/Applications/Example.app",
        installedVersion: "2.0.0",
        buildVersion: "200",
        versionEvidence: "bundle-info-plist",
        arch: "arm64",
        weakIdentity: false,
        source: emptySource(),
        artifact: emptyArtifact(),
        receipts: [],
        observedApps: [],
        verification: emptyVerification(),
        lastResult: "updated",
      },
      existing,
      existing.id,
    );
    expect(built.installedAt).toBe(existing.installedAt);
    expect(built.aliases.sort()).toEqual(["Antigo", "Novo"]);
    expect(built.previousVersion).toBe("1.0.0");
    expect(built.installedVersion).toBe("2.0.0");
  });

  test("archsOf/formatArch/sameArchs/slugify", () => {
    expect(archsOf(base({ arch: "arm64 x86_64" }))).toEqual(["arm64", "x86_64"]);
    expect(archsOf(base({ arch: null }))).toBeNull();
    expect(formatArch("arm64 x86_64")).toBe("universal");
    expect(formatArch("arm64")).toBe("arm64");
    expect(sameArchs(["arm64", "x86_64"], ["x86_64", "arm64"])).toBe(true);
    expect(sameArchs(["arm64"], ["x86_64"])).toBe(false);
    expect(sameArchs(null, ["arm64"])).toBe(true);
    expect(slugify("Example Editor.app")).toBe("example-editor");
    expect(slugify("!!!")).toBe("item");
  });
});
