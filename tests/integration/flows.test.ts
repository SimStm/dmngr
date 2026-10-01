import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { listAttachedImages } from "../../src/core/install/dmg.ts";
import { mkdir, readFile } from "node:fs/promises";
import {
  cleanupDir,
  createAppBundle,
  createDmg,
  createPkg,
  envFor,
  readJson,
  runCli,
  runCommand,
  tempRoot,
} from "../helpers/fixtures.ts";

const integration = process.env.DMNGR_INTEGRATION === "1";

// DMGs e PKGs reais: cada teste pode levar alguns segundos.
setDefaultTimeout(120_000);

describe.skipIf(!integration)("fluxo DMG→app de ponta a ponta", () => {
  let root: string;
  let stateDir: string;
  let destDir: string;
  let dmgV1: string;
  let dmgV2: string;
  const appName = "DmngrE2E";

  beforeAll(async () => {
    root = await tempRoot("dmngr-e2e");
    stateDir = join(root, "state");
    destDir = join(root, "dest");
    await Bun.write(join(root, ".keep"), "");
    const v1Dir = join(root, "v1");
    const v2Dir = join(root, "v2");
    await createAppBundle(v1Dir, {
      name: appName,
      bundleId: "com.dmngr.e2e",
      displayName: "Dmngr E2E",
      shortVersion: "1.0.0",
      buildVersion: "100",
    });
    dmgV1 = await createDmg(v1Dir, join(root, "DmngrE2E-1.0.0.dmg"), "DmngrE2E");
    await createAppBundle(v2Dir, {
      name: appName,
      bundleId: "com.dmngr.e2e",
      displayName: "Dmngr E2E",
      shortVersion: "2.0.0",
      buildVersion: "200",
    });
    dmgV2 = await createDmg(v2Dir, join(root, "DmngrE2E-2.0.0.dmg"), "DmngrE2E");
  });

  afterAll(async () => {
    await cleanupDir(root);
  });

  function env(extra: Record<string, string> = {}): Record<string, string> {
    return envFor(stateDir, extra);
  }

  test("instala o app, registra versão e não deixa imagens montadas", async () => {
    const result = await runCli(
      ["install", dmgV1, "--destination", destDir, "--allow-unverified", "--json"],
      env(),
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      action: string;
      item: { id: string; installedVersion: string; installedPath: string };
    };
    expect(payload.action).toBe("installed");
    expect(payload.item.id).toBe("com.dmngr.e2e");
    expect(payload.item.installedVersion).toBe("1.0.0");
    expect(await Bun.file(join(payload.item.installedPath, "Contents", "Info.plist")).exists()).toBe(true);

    const registry = (await readJson(join(stateDir, "registry.json"))) as {
      items: { id: string; installedVersion: string; verification: { overrides: string[] } }[];
    };
    expect(registry.items).toHaveLength(1);
    expect(registry.items[0]?.verification.overrides).toContain("unverified");

    const images = await listAttachedImages();
    expect(images.filter((image) => image.imagePath.includes("dmngr-e2e"))).toHaveLength(0);
  });

  test("instalar novamente a mesma versão é no-op", async () => {
    const result = await runCli(["install", dmgV1, "--destination", destDir, "--allow-unverified", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string };
    expect(payload.action).toBe("noop");
  });

  test("--reinstall força a reinstalação", async () => {
    const result = await runCli(
      ["install", dmgV1, "--destination", destDir, "--allow-unverified", "--reinstall", "--json"],
      env(),
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string };
    expect(payload.action).toBe("updated");
  });

  test("nova versão atualiza por identidade", async () => {
    const result = await runCli(["install", dmgV2, "--destination", destDir, "--allow-unverified", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string; item: { installedVersion: string } };
    expect(payload.action).toBe("updated");
    expect(payload.item.installedVersion).toBe("2.0.0");

    const info = await runCli(["info", "com.dmngr.e2e", "--json"], env());
    expect(info.code).toBe(0);
    const infoPayload = JSON.parse(info.stdout) as {
      item: { previousVersion: string; live: { installedVersion: string; drift: boolean } };
    };
    expect(infoPayload.item.previousVersion).toBe("1.0.0");
    expect(infoPayload.item.live.installedVersion).toBe("2.0.0");
    expect(infoPayload.item.live.drift).toBe(false);
  });

  test("update --url com artefato mais novo e downgrade recusado", async () => {
    const downgrade = await runCli(
      ["update", "com.dmngr.e2e", "--url", dmgV1, "--allow-unverified", "--yes"],
      env(),
    );
    expect(downgrade.code).toBe(6);
    expect(downgrade.stderr).toContain("downgrade");

    const upgrade = await runCli(
      ["update", "com.dmngr.e2e", "--url", dmgV2, "--allow-unverified", "--yes", "--json"],
      env(),
    );
    expect(upgrade.code).toBe(0);
    const payload = JSON.parse(upgrade.stdout) as { action: string };
    expect(["updated", "noop"]).toContain(payload.action);
  });

  test("update por URL de app desconhecido exige --app", async () => {
    const outraDir = join(root, "outra");
    await createAppBundle(outraDir, { name: "OutroApp", bundleId: "com.dmngr.outro", shortVersion: "1.0.0" });
    const outroDmg = await createDmg(outraDir, join(root, "Outro-1.0.0.dmg"), "Outro");
    const result = await runCli(["update", outroDmg, "--allow-unverified", "--yes"], env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("install");
  });

  test("check em origem local devolve unknown com dica de --url", async () => {
    const result = await runCli(["check", "com.dmngr.e2e", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { items: { status: string; hint: string }[] };
    expect(payload.items[0]?.status).toBe("unknown");
    expect(payload.items[0]?.hint).toContain("--url");
  });

  test("list mostra o item instalado", async () => {
    const result = await runCli(["list", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { items: { id: string; state: string; installedVersion: string }[] };
    expect(payload.items[0]?.id).toBe("com.dmngr.e2e");
    expect(payload.items[0]?.state).toBe("ok");
    expect(payload.items[0]?.installedVersion).toBe("2.0.0");
  });

  test("conflito com app diferente no destino exige decisão (3)", async () => {
    const destConflito = join(root, "dest-conflito");
    await mkdir(destConflito, { recursive: true });
    const ocupante = await createAppBundle(join(root, "conflito-ocupante"), {
      name: "DmngrE2E",
      bundleId: "com.dmngr.ocupante",
      shortVersion: "1.0.0",
    });
    await runCommand(["ditto", ocupante, join(destConflito, "DmngrE2E.app")]);

    const novoDir = join(root, "conflito-novo");
    await createAppBundle(novoDir, { name: "DmngrE2E", bundleId: "com.dmngr.novo", shortVersion: "1.0.0" });
    const novoDmg = await createDmg(novoDir, join(root, "Conflito-1.0.0.dmg"), "Conflito");

    const result = await runCli(
      ["install", novoDmg, "--destination", destConflito, "--allow-unverified", "--yes"],
      env(),
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("já existe");
    const plist = await readFile(join(destConflito, "DmngrE2E.app", "Contents", "Info.plist"), "utf8");
    expect(plist).toContain("com.dmngr.ocupante"); // nada foi sobrescrito
  });

  test("doctor não encontra problemas estruturais", async () => {
    const result = await runCli(["doctor", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { summary: { error: number } };
    expect(payload.summary.error).toBe(0);
  });
});

describe.skipIf(!integration)("fluxo PKG", () => {
  let root: string;
  let stateDir: string;

  beforeAll(async () => {
    root = await tempRoot("dmngr-pkg-e2e");
    stateDir = join(root, "state");
  });

  afterAll(async () => {
    await cleanupDir(root);
  });

  test("inspeção identifica componentes, versão, scripts e ausência de assinatura", async () => {
    const pkg = await createPkg(root, {
      identifier: "com.dmngr.pkgtest",
      version: "2.3.4",
      bundleId: "com.dmngr.pkgtest.app",
      scripts: { postinstall: "#!/bin/sh\nexit 0\n" },
    });
    const { inspectPkg } = await import("../../src/core/inspect/pkg.ts");
    const info = await inspectPkg(pkg);
    expect(info.components[0]?.identifier).toBe("com.dmngr.pkgtest");
    expect(info.components[0]?.version).toBe("2.3.4");
    expect(info.components[0]?.hasScripts).toBe(true);
    expect(info.signature.signed).toBe(false);
    const { payloadAppPaths } = await import("../../src/core/inspect/pkg.ts");
    expect(payloadAppPaths(info).some((entry) => entry.bundleId === "com.dmngr.pkgtest.app")).toBe(true);
  });

  test("dry-run mostra exigências sem instalar", async () => {
    const pkg = await createPkg(root, { identifier: "com.dmngr.pkgdry", version: "1.0.0" });
    const result = await runCli(["install", pkg, "--dry-run", "--json"], envFor(stateDir));
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string; notes: string[]; installedVersion: string };
    expect(payload.action).toBe("planned");
    expect(payload.installedVersion).toBe("1.0.0");
    expect(payload.notes.join(" ")).toContain("--allow-unverified");
  });

  test("sem --allow-unverified a instalação é bloqueada por segurança (5)", async () => {
    const pkg = await createPkg(root, { identifier: "com.dmngr.pkgblock", version: "1.0.0" });
    const result = await runCli(["install", pkg, "--yes"], envFor(stateDir));
    expect(result.code).toBe(5);
  });

  test("sem privilégio, --elevate none explica o comando manual", async () => {
    const pkg = await createPkg(root, { identifier: "com.dmngr.pkgnone", version: "1.0.0" });
    const result = await runCli(["install", pkg, "--allow-unverified", "--elevate", "none", "--yes"], envFor(stateDir));
    expect(result.code).toBe(6);
    expect(result.stderr).toContain("sudo installer");
  });

  test.skipIf(process.getuid?.() !== 0)("instala o PKG quando roda como root e registra receipts", async () => {
    const pkg = await createPkg(root, { identifier: "com.dmngr.pkgroot", version: "1.0.0", installLocation: "/Applications" });
    const result = await runCli(["install", pkg, "--allow-unverified", "--yes", "--json"], envFor(stateDir));
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string; item: { id: string; installedVersion: string } };
    expect(payload.action).toBe("installed");
    expect(payload.item.id).toBe("com.dmngr.pkgroot");
    expect(payload.item.installedVersion).toBe("1.0.0");
    const { runCommand } = await import("../helpers/fixtures.ts");
    await runCommand(["pkgutil", "--forget", "com.dmngr.pkgroot"]);
  });
});
