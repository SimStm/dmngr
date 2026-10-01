import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanupDir, runCli, tempRoot } from "../helpers/fixtures.ts";

let stateDir: string;

beforeAll(async () => {
  stateDir = await tempRoot("dmngr-cli");
});

afterAll(async () => {
  await cleanupDir(stateDir);
});

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { DMNGR_APP_SUPPORT_DIR: stateDir, ...extra };
}

describe("CLI", () => {
  test("--help sai com 0 e mostra o uso", async () => {
    const result = await runCli(["--help"], env());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: dmngr");
    expect(result.stdout).toContain("install");
  });

  test("--version mostra a versão", async () => {
    const result = await runCli(["--version"], env());
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("opção desconhecida sai com código de uso (2)", async () => {
    const result = await runCli(["list", "--inexistente"], env());
    expect(result.code).toBe(2);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("list --json em registro vazio devolve JSON estável", async () => {
    const result = await runCli(["list", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { schemaVersion: number; items: unknown[] };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.items).toEqual([]);
  });

  test("info de item inexistente sai com 2 e sugere list", async () => {
    const result = await runCli(["info", "nao-existe"], env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("não encontrado");
  });

  test("registro corrompido sai com 7 (estado inconsistente)", async () => {
    const dir = await tempRoot("dmngr-cli-corrupt");
    try {
      await Bun.write(join(dir, "registry.json"), "isso não é json");
      const result = await runCli(["list"], env({ DMNGR_APP_SUPPORT_DIR: dir }));
      expect(result.code).toBe(7);
      expect(result.stderr).toContain("registro");
    } finally {
      await cleanupDir(dir);
    }
  });

  test("erros em --json vão para o stderr como JSON", async () => {
    const result = await runCli(["info", "nao-existe", "--json"], env());
    expect(result.code).toBe(2);
    expect(result.stdout.trim()).toBe("");
    const payload = JSON.parse(result.stderr) as { error: { kind: string; status: number } };
    expect(payload.error.kind).toBe("usage");
    expect(payload.error.status).toBe(2);
  });

  test("install --dry-run de uma URL não baixa e descreve o plano", async () => {
    const result = await runCli(["install", "https://example.com/App-1.2.3.dmg", "--dry-run", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { action: string; notes: string[]; artifact: { fileName: string } };
    expect(payload.action).toBe("planned");
    expect(payload.artifact.fileName).toBe("App-1.2.3.dmg");
    expect(payload.notes.join(" ")).toContain("não foram executados");
  });

  test("bloqueia destino privado sem --allow-private-network (segurança, 5)", async () => {
    const result = await runCli(["install", "https://127.0.0.1/App.dmg", "--yes"], env());
    expect(result.code).toBe(5);
    expect(result.stderr).toContain("--allow-private-network");
  });

  test("doctor roda sem itens e sai com 0", async () => {
    const result = await runCli(["doctor", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { summary: Record<string, number>; issues: unknown[] };
    expect(payload.summary.error).toBe(0);
    expect(payload.issues.length).toBeGreaterThan(0);
  });

  test("--pin com --latest é erro de uso", async () => {
    const result = await runCli(["install", "https://example.com/App.dmg", "--pin", "--latest"], env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--pin ou --latest");
  });

  test("--pin exige uma URL que fixe versão", async () => {
    const result = await runCli(["install", "https://github.com/acme/editor", "--pin"], env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("fixe uma versão");
  });

  test("check --prerelease e update --help expõem o canal", async () => {
    const check = await runCli(["check", "--prerelease"], env());
    expect(check.code).toBe(0);
    const updateHelp = await runCli(["update", "--help"], env());
    expect(updateHelp.code).toBe(0);
    expect(updateHelp.stdout).toContain("--prerelease");
    expect(updateHelp.stdout).toContain("--allow-arch-mismatch");
  });

  test("doctor reporta o ambiente (macOS e arquitetura)", async () => {
    const result = await runCli(["doctor", "--json"], env());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { issues: { area: string; message: string }[] };
    const environment = payload.issues.find((issue) => issue.area === "ambiente");
    expect(environment?.message).toContain("macOS");
    expect(environment?.message).toMatch(/arm64|Intel/);
  });

  test("update sem argumento explica o uso", async () => {
    const result = await runCli(["update"], env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--all");
  });
});
