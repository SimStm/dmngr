import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { AmbiguityError, StateError } from "../../src/core/errors.ts";
import { acquireLock } from "../../src/core/registry/lock.ts";
import { findItemsByIdentity, matchItems, resolveItem, suggestItems } from "../../src/core/registry/resolve.ts";
import {
  emptyArtifact,
  emptySource,
  emptyVerification,
  validateRegistry,
  type RegistryItem,
} from "../../src/core/registry/schema.ts";
import { findItemById, loadRegistry, saveRegistry, uniqueItemId, updateRegistry } from "../../src/core/registry/store.ts";
import { cleanupDir, tempRoot } from "../helpers/fixtures.ts";

let stateDir: string;

beforeAll(async () => {
  stateDir = await tempRoot("dmngr-registry");
  process.env.DMNGR_APP_SUPPORT_DIR = stateDir;
});

afterAll(async () => {
  await cleanupDir(stateDir);
});

function sampleItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    id: "com.example.app",
    displayName: "Example",
    aliases: [],
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

describe("validateRegistry", () => {
  test("aceita registro vazio e item completo", () => {
    expect(validateRegistry({ schemaVersion: 1, items: [] })).toEqual({ schemaVersion: 1, items: [] });
    const registry = validateRegistry({ schemaVersion: 1, items: [sampleItem()] });
    expect(registry.items[0]?.id).toBe("com.example.app");
  });

  test("rejeita id duplicado, campos inválidos e schema futuro", () => {
    expect(() => validateRegistry({ schemaVersion: 1, items: [sampleItem(), sampleItem()] })).toThrow(StateError);
    expect(() => validateRegistry({ schemaVersion: 1, items: [{ ...sampleItem(), kind: "zip" }] })).toThrow(StateError);
    expect(() => validateRegistry({ schemaVersion: 1, items: [{ ...sampleItem(), installedAt: 42 }] })).toThrow(StateError);
    expect(() => validateRegistry({ schemaVersion: 99, items: [] })).toThrow(StateError);
    expect(() => validateRegistry("nada")).toThrow(StateError);
  });
});

describe("store", () => {
  test("grava atomicamente com permissões restritivas e relê", async () => {
    await saveRegistry({ schemaVersion: 1, items: [sampleItem()] });
    const mode = (await stat(join(stateDir, "registry.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
    const registry = await loadRegistry();
    expect(registry.items).toHaveLength(1);
    expect(registry.items[0]?.displayName).toBe("Example");
  });

  test("registro ausente vira registro vazio", async () => {
    const other = await tempRoot("dmngr-empty");
    const previous = process.env.DMNGR_APP_SUPPORT_DIR;
    process.env.DMNGR_APP_SUPPORT_DIR = other;
    try {
      const registry = await loadRegistry();
      expect(registry.items).toEqual([]);
    } finally {
      process.env.DMNGR_APP_SUPPORT_DIR = previous;
      await cleanupDir(other);
    }
  });

  test("registro corrompido falha com StateError", async () => {
    const file = join(stateDir, "registry.json");
    const backup = await readFile(file, "utf8");
    await Bun.write(file, "{ isso não é json");
    await expect(loadRegistry()).rejects.toThrow(StateError);
    await Bun.write(file, backup);
  });

  test("updateRegistry muta sob lock e uniqueItemId evita colisão", async () => {
    const id = await updateRegistry((registry) => {
      const generated = uniqueItemId(registry, "com.example.app");
      registry.items.push({ ...sampleItem(), id: generated, displayName: "Cópia" });
      return generated;
    });
    expect(id).toBe("com.example.app#2");
    const registry = await loadRegistry();
    expect(findItemById(registry, "com.example.app#2")?.displayName).toBe("Cópia");
  });

  test("lock é exclusivo e detecta lock obsoleto", async () => {
    const release = await acquireLock({ timeoutMs: 200 });
    await expect(acquireLock({ timeoutMs: 100 })).rejects.toThrow(Error);
    await release();

    await Bun.write(join(stateDir, "registry.lock"), JSON.stringify({ pid: 999_999_999, startedAt: "2020-01-01T00:00:00Z" }));
    const releaseStale = await acquireLock({ timeoutMs: 1000 });
    await releaseStale();
  });
});

describe("resolve", () => {
  const items = [
    sampleItem({ id: "com.example.editor", displayName: "Example Editor", aliases: ["editor"] }),
    sampleItem({ id: "com.example.viewer", displayName: "Example Viewer" }),
  ];

  test("casa por id, nome e alias", () => {
    expect(resolveItem(items, "com.example.editor")?.id).toBe("com.example.editor");
    expect(resolveItem(items, "example editor")?.id).toBe("com.example.editor");
    expect(resolveItem(items, "editor")?.id).toBe("com.example.editor");
    expect(resolveItem(items, "inexistente")).toBeNull();
    expect(matchItems(items, "example editor")).toHaveLength(1);
  });

  test("nunca escolhe sozinho em ambiguidade", () => {
    const duplicated = [sampleItem({ id: "a", displayName: "Mesmo" }), sampleItem({ id: "b", displayName: "mesmo" })];
    expect(() => resolveItem(duplicated, "MESMO")).toThrow(AmbiguityError);
    const matches = matchItems(duplicated, "Mesmo");
    expect(matches).toHaveLength(2);
  });

  test("sugere itens parecidos", () => {
    expect(suggestItems(items, "view")).toEqual(["com.example.viewer"]);
  });

  test("associa por identidade (bundle id e identificadores de pkg)", () => {
    const pkgItem = sampleItem({
      id: "com.example.pkg",
      kind: "pkg",
      bundleId: null,
      receipts: [{ identifier: "com.example.pkg.payload", version: "1.0", installLocation: "/", installed: true }],
    });
    expect(findItemsByIdentity([...items, pkgItem], { bundleId: "com.example.editor", pkgIdentifiers: [], displayName: null })).toHaveLength(1);
    expect(
      findItemsByIdentity([...items, pkgItem], { bundleId: null, pkgIdentifiers: ["com.example.pkg.payload"], displayName: null }),
    ).toHaveLength(1);
    expect(findItemsByIdentity([...items, pkgItem], { bundleId: "nada", pkgIdentifiers: [], displayName: "Nome do arquivo" })).toHaveLength(0);
  });
});

describe("permissões do diretório de estado", () => {
  test("diretório de estado é 0700", async () => {
    await updateRegistry(() => undefined);
    const mode = (await stat(stateDir)).mode & 0o777;
    await chmod(stateDir, 0o700);
    expect(mode & 0o077).toBe(0);
  });
});
