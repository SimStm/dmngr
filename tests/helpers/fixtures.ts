import { chmod, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunCliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function repoRoot(): string {
  return join(import.meta.dir, "..", "..");
}

export function cliEntry(): string {
  return join(repoRoot(), "src", "index.ts");
}

export async function runCommand(cmd: string[], options: { env?: Record<string, string>; cwd?: string } = {}): Promise<RunCliResult> {
  const process_ = Bun.spawn({
    cmd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: options.env === undefined ? undefined : { ...process.env, ...options.env },
    cwd: options.cwd,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process_.stdout).text(),
    new Response(process_.stderr).text(),
    process_.exited,
  ]);
  return { code, stdout, stderr };
}

export async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunCliResult> {
  return await runCommand(["bun", "run", cliEntry(), ...args], { env });
}

export interface AppFixtureOptions {
  name?: string;
  bundleId?: string | null;
  displayName?: string | null;
  shortVersion?: string | null;
  buildVersion?: string | null;
  executable?: string | null;
  /** default: assinatura ad-hoc (codesign --verify passa, spctl rejeita) */
  signed?: boolean;
}

export async function createAppBundle(parentDir: string, options: AppFixtureOptions = {}): Promise<string> {
  const name = options.name ?? "DmngrTest";
  const appPath = join(parentDir, `${name}.app`);
  const executable = options.executable === undefined ? name : options.executable;
  const bundleId = options.bundleId === undefined ? `com.dmngr.${name.toLowerCase()}` : options.bundleId;
  await mkdir(join(appPath, "Contents", "MacOS"), { recursive: true });

  const entries: string[] = [];
  const push = (key: string, value: string | null): void => {
    if (value === null) return;
    entries.push(`<key>${key}</key><string>${escapeXml(value)}</string>`);
  };
  push("CFBundleIdentifier", bundleId);
  push("CFBundleName", name);
  push("CFBundleDisplayName", options.displayName === undefined ? null : options.displayName);
  push("CFBundleExecutable", executable);
  push("CFBundleShortVersionString", options.shortVersion === undefined ? "1.0.0" : options.shortVersion);
  push("CFBundleVersion", options.buildVersion === undefined ? "100" : options.buildVersion);

  await writeFile(
    join(appPath, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries.join("")}</dict></plist>\n`,
  );
  if (executable !== null) {
    const binary = join(appPath, "Contents", "MacOS", executable);
    await writeFile(binary, "#!/bin/sh\necho dmngr-fixture\n");
    await chmod(binary, 0o755);
  }
  if (options.signed !== false) await signAdhoc(appPath);
  return appPath;
}

export async function signAdhoc(appPath: string): Promise<void> {
  const result = await runCommand(["codesign", "-s", "-", "--force", appPath]);
  if (result.code !== 0) throw new Error(`codesign falhou: ${result.stderr}`);
}

export async function createDmg(sourceDir: string, outputPath: string, volumeName = "DmngrTest"): Promise<string> {
  const result = await runCommand([
    "hdiutil",
    "create",
    "-quiet",
    "-volname",
    volumeName,
    "-srcfolder",
    sourceDir,
    "-ov",
    "-format",
    "UDZO",
    outputPath,
  ]);
  if (result.code !== 0) throw new Error(`hdiutil create falhou: ${result.stderr}`);
  return outputPath;
}

export interface PkgFixtureOptions {
  identifier: string;
  version: string;
  installLocation?: string;
  appName?: string;
  bundleId?: string | null;
  shortVersion?: string;
  scripts?: Record<string, string>;
}

export async function createPkg(workDir: string, options: PkgFixtureOptions): Promise<string> {
  const root = join(workDir, `root-${options.identifier}`);
  const appName = options.appName ?? "DmngrPkg";
  await createAppBundle(join(root, join("Applications")), {
    name: appName,
    bundleId: options.bundleId === undefined ? `${options.identifier}.app` : options.bundleId,
    shortVersion: options.shortVersion ?? options.version,
    signed: false,
  });
  const args = [
    "pkgbuild",
    "--quiet",
    "--root",
    root,
    "--identifier",
    options.identifier,
    "--version",
    options.version,
    "--install-location",
    options.installLocation ?? "/",
  ];
  if (options.scripts !== undefined && Object.keys(options.scripts).length > 0) {
    const scriptsDir = join(workDir, `scripts-${options.identifier}`);
    await mkdir(scriptsDir, { recursive: true });
    for (const [name, content] of Object.entries(options.scripts)) {
      const file = join(scriptsDir, name);
      await writeFile(file, content);
      await chmod(file, 0o755);
    }
    args.push("--scripts", scriptsDir);
  }
  const output = join(workDir, `${options.identifier}-${options.version}.pkg`);
  args.push(output);
  const result = await runCommand(args);
  if (result.code !== 0) throw new Error(`pkgbuild falhou: ${result.stderr}`);
  return output;
}

export async function tempRoot(prefix: string): Promise<string> {
  const base = process.env.DMNGR_TEST_TMP ?? tmpdir();
  const dir = join(base, `${prefix}-${Math.random().toString(36).slice(2, 10)}`);
  await mkdir(dir, { recursive: true });
  // caminho canônico: no macOS /var é um symlink para /private/var
  return await realpath(dir);
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export function envFor(stateDir: string, extra: Record<string, string> = {}): Record<string, string> {
  return { DMNGR_APP_SUPPORT_DIR: stateDir, ...extra };
}

export async function readJson(path: string): Promise<unknown> {
  return await Bun.file(path).json();
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
