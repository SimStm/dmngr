import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createCtx, defaultOperationOptions } from "../../src/core/ops/context.ts";
import { runUninstall } from "../../src/core/ops/uninstall.ts";
import {
  emptyArtifact,
  emptySource,
  emptyVerification,
  type Registry,
  type RegistryItem,
} from "../../src/core/registry/schema.ts";
import { pathExists } from "../../src/core/fsx.ts";
import {
  cleanupDir,
  createAppBundle,
  envFor,
  readJson,
  runCli,
  tempRoot,
} from "../helpers/fixtures.ts";
import { writeFileAtomic, ensureDir } from "../../src/core/fsx.ts";

function sampleItem(overrides: Partial<RegistryItem>): RegistryItem {
  const now = new Date().toISOString();
  return {
    id: "com.dmngr.uninst",
    displayName: "Uninst",
    aliases: ["Uninst"],
    kind: "app",
    artifactType: "dmg",
    bundleId: "com.dmngr.uninst",
    installedPath: null,
    installedVersion: "1.0.0",
    buildVersion: "1",
    versionEvidence: "bundle-info-plist",
    arch: null,
    weakIdentity: false,
    source: emptySource(),
    artifact: emptyArtifact(),
    receipts: [],
    observedApps: [],
    verification: emptyVerification(),
    installedAt: now,
    updatedAt: now,
    lastCheckedAt: null,
    lastCheckStatus: null,
    lastResult: "installed",
    previousVersion: null,
    ...overrides,
  };
}

async function writeRegistry(stateDir: string, items: RegistryItem[]): Promise<void> {
  await ensureDir(stateDir, 0o700);
  const registry: Registry = { schemaVersion: 1, items };
  await writeFileAtomic(join(stateDir, "registry.json"), `${JSON.stringify(registry, null, 2)}\n`, 0o600);
}

describe("uninstall", () => {
  test("remove e rm são aliases de uninstall no help", async () => {
    const help = await runCli(["uninstall", "--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(/--keep-files/);

    for (const name of ["remove", "rm"] as const) {
      const result = await runCli([name, "--help"]);
      expect(result.code).toBe(0);
      expect(result.stdout.toLowerCase()).toMatch(/remove|registro|desinstal/);
    }
  });

  test("apaga o .app no caminho registrado e tira do registro", async () => {
    const dir = await tempRoot("dmngr-uninstall");
    const previous = process.env.DMNGR_APP_SUPPORT_DIR;
    try {
      const stateDir = join(dir, "state");
      const dest = join(dir, "Apps");
      await mkdir(dest, { recursive: true });
      const app = await createAppBundle(dest, {
        name: "Uninst",
        bundleId: "com.dmngr.uninst",
        shortVersion: "1.0.0",
      });
      await writeRegistry(stateDir, [
        sampleItem({
          installedPath: app,
          observedApps: [{ path: app, bundleId: "com.dmngr.uninst", version: "1.0.0" }],
        }),
      ]);
      process.env.DMNGR_APP_SUPPORT_DIR = stateDir;

      const ctx = await createCtx(defaultOperationOptions({ yes: true }));
      const result = await runUninstall(ctx, "Uninst", { keepFiles: false });
      expect(result.action).toBe("uninstalled");
      expect(result.removedPaths).toEqual([app]);
      expect(await pathExists(app)).toBe(false);

      const registry = (await readJson(join(stateDir, "registry.json"))) as Registry;
      expect(registry.items).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.DMNGR_APP_SUPPORT_DIR;
      else process.env.DMNGR_APP_SUPPORT_DIR = previous;
      await cleanupDir(dir);
    }
  });

  test("--keep-files só esquece o registro", async () => {
    const dir = await tempRoot("dmngr-uninstall-keep");
    const previous = process.env.DMNGR_APP_SUPPORT_DIR;
    try {
      const stateDir = join(dir, "state");
      const dest = join(dir, "Apps");
      await mkdir(dest, { recursive: true });
      const app = await createAppBundle(dest, {
        name: "KeepMe",
        bundleId: "com.dmngr.keepme",
      });
      await writeRegistry(stateDir, [
        sampleItem({
          id: "com.dmngr.keepme",
          displayName: "KeepMe",
          bundleId: "com.dmngr.keepme",
          installedPath: app,
        }),
      ]);
      process.env.DMNGR_APP_SUPPORT_DIR = stateDir;

      const result = await runCli(
        ["rm", "KeepMe", "--keep-files", "--yes", "--json"],
        envFor(stateDir),
      );
      expect(result.code).toBe(0);
      const payload = JSON.parse(result.stdout) as { action: string; keptFiles: boolean };
      expect(payload.action).toBe("forgotten");
      expect(payload.keptFiles).toBe(true);
      expect(await pathExists(app)).toBe(true);
      const registry = (await readJson(join(stateDir, "registry.json"))) as Registry;
      expect(registry.items).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.DMNGR_APP_SUPPORT_DIR;
      else process.env.DMNGR_APP_SUPPORT_DIR = previous;
      await cleanupDir(dir);
    }
  });

  test("recusa se o bundle id no disco divergir", async () => {
    const dir = await tempRoot("dmngr-uninstall-id");
    const previous = process.env.DMNGR_APP_SUPPORT_DIR;
    try {
      const stateDir = join(dir, "state");
      const dest = join(dir, "Apps");
      await mkdir(dest, { recursive: true });
      const app = await createAppBundle(dest, {
        name: "Other",
        bundleId: "com.dmngr.other",
      });
      await writeRegistry(stateDir, [
        sampleItem({
          installedPath: app,
          bundleId: "com.dmngr.expected",
        }),
      ]);
      process.env.DMNGR_APP_SUPPORT_DIR = stateDir;
      const ctx = await createCtx(defaultOperationOptions({ yes: true }));
      await expect(runUninstall(ctx, "com.dmngr.uninst", { keepFiles: false })).rejects.toMatchObject({
        exitCode: 5,
      });
      expect(await pathExists(app)).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.DMNGR_APP_SUPPORT_DIR;
      else process.env.DMNGR_APP_SUPPORT_DIR = previous;
      await cleanupDir(dir);
    }
  });
});
