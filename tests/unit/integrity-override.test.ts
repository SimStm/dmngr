import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assessAppSignature } from "../../src/core/inspect/app-bundle.ts";
import { run } from "../../src/core/process.ts";
import {
  cleanupDir,
  createDmg,
  envFor,
  readJson,
  runCli,
  runCommand,
  tempRoot,
} from "../helpers/fixtures.ts";

/** App Mach-O ad-hoc assinado com resource fork — faz codesign --verify --strict falhar. */
async function createIntegrityBrokenApp(parentDir: string, name: string): Promise<string> {
  const app = join(parentDir, `${name}.app`);
  await mkdir(join(app, "Contents", "MacOS"), { recursive: true });
  await mkdir(join(app, "Contents", "Resources"), { recursive: true });
  await writeFile(
    join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.dmngr.${name.toLowerCase()}</string>
  <key>CFBundleName</key><string>${name}</string>
  <key>CFBundleExecutable</key><string>${name}</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
</dict></plist>
`,
  );
  const note = join(app, "Contents", "Resources", "note.txt");
  await writeFile(note, "hello\n");
  const cFile = join(parentDir, `${name}.c`);
  await writeFile(cFile, "int main(void){return 0;}\n");
  const clang = await runCommand(["clang", "-o", join(app, "Contents", "MacOS", name), cFile]);
  if (clang.code !== 0) throw new Error(`clang falhou: ${clang.stderr}`);
  const sign = await run(["codesign", "-s", "-", "--force", "--options", "runtime", app]);
  if (sign.code !== 0) throw new Error(`codesign falhou: ${sign.stderr}`);
  // Resource fork fora do selo → mensagem de detritus do codesign --strict
  const rsrc = await runCommand(["bash", "-c", `printf junk > ${JSON.stringify(`${note}/..namedfork/rsrc`)}`]);
  if (rsrc.code !== 0) throw new Error(`resource fork falhou: ${rsrc.stderr}`);
  return app;
}

describe("override integrity", () => {
  test("codesign --strict falha no fixture com resource fork", async () => {
    const dir = await tempRoot("dmngr-integrity-assess");
    try {
      const app = await createIntegrityBrokenApp(dir, "BrokenSeal");
      const assessment = await assessAppSignature(app);
      expect(assessment.integrityOk).toBe(false);
      expect(assessment.details).toMatch(/codesign: falhou/);
    } finally {
      await cleanupDir(dir);
    }
  });

  test(
    "install bloqueia sem aceite e registra integrity com --allow-unverified",
    async () => {
      const dir = await tempRoot("dmngr-integrity-install");
      try {
        const stateDir = join(dir, "state");
        const destDir = join(dir, "dest");
        await mkdir(destDir, { recursive: true });
        const stage = join(dir, "stage");
        await mkdir(stage, { recursive: true });
        await createIntegrityBrokenApp(stage, "BrokenSeal");
        const dmg = await createDmg(stage, join(dir, "BrokenSeal.dmg"), "BrokenSeal");

        const blocked = await runCli(["install", dmg, "--destination", destDir, "--json", "--yes"], envFor(stateDir));
        expect(blocked.code).toBe(5);
        expect(blocked.stderr).toMatch(/assinatura.*inválida|codesign --verify falhou/i);
        expect(blocked.stderr).toMatch(/--allow-unverified/);

        const allowed = await runCli(
          ["install", dmg, "--destination", destDir, "--allow-unverified", "--json", "--yes"],
          envFor(stateDir),
        );
        expect(allowed.code).toBe(0);
        const registry = (await readJson(join(stateDir, "registry.json"))) as {
          items: { verification: { integrityOk: boolean | null; overrides: string[] } }[];
        };
        expect(registry.items).toHaveLength(1);
        const verification = registry.items[0]?.verification;
        expect(verification?.integrityOk).toBe(false);
        expect(verification?.overrides).toContain("integrity");
      } finally {
        await cleanupDir(dir);
      }
    },
    60_000,
  );
});
