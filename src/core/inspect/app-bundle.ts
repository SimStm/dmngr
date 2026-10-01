import { basename, join } from "node:path";
import { StateError } from "../errors.ts";
import { isDirectory, pathExists } from "../fsx.ts";
import { plistToJsonFromFile } from "../plist.ts";
import { run } from "../process.ts";

export interface AppBundleInfo {
  path: string;
  bundleId: string | null;
  name: string | null;
  shortVersion: string | null;
  buildVersion: string | null;
  executable: string | null;
  minSystemVersion: string | null;
  archs: string[] | null;
}

export interface SignatureAssessment {
  integrityOk: boolean;
  signed: boolean;
  notarized: boolean;
  teamId: string | null;
  authority: string | null;
  details: string;
}

export async function isAppBundle(path: string): Promise<boolean> {
  if (!path.endsWith(".app")) return false;
  if (!(await isDirectory(path))) return false;
  return await pathExists(join(path, "Contents", "Info.plist"));
}

export async function readAppBundle(path: string): Promise<AppBundleInfo> {
  const infoPath = join(path, "Contents", "Info.plist");
  if (!(await pathExists(infoPath))) {
    throw new StateError(`não há Contents/Info.plist em ${path}`, {
      hint: "o candidato não é um bundle de aplicativo válido",
    });
  }
  const raw = await plistToJsonFromFile<Record<string, unknown>>(infoPath);
  const executable = stringValue(raw.CFBundleExecutable);
  const archs = executable === null ? null : await lipoArchs(join(path, "Contents", "MacOS", executable));
  return {
    path,
    bundleId: stringValue(raw.CFBundleIdentifier),
    name: stringValue(raw.CFBundleDisplayName) ?? stringValue(raw.CFBundleName) ?? basename(path, ".app"),
    shortVersion: stringValue(raw.CFBundleShortVersionString),
    buildVersion: stringValue(raw.CFBundleVersion),
    executable,
    minSystemVersion: stringValue(raw.LSMinimumSystemVersion),
    archs,
  };
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function lipoArchs(binaryPath: string): Promise<string[] | null> {
  if (!(await pathExists(binaryPath))) return null;
  const result = await run(["lipo", "-archs", binaryPath]);
  if (result.code !== 0) return null;
  const archs = result.stdout.trim().split(/\s+/).filter((arch) => arch.length > 0);
  return archs.length > 0 ? archs : null;
}

/** Detecta o app em execução comparando o caminho do executável visto pelo `ps`. */
export async function isAppRunning(appPath: string, executable: string | null): Promise<boolean> {
  const result = await run(["ps", "-Ao", "comm="]);
  if (result.code !== 0) return false;
  const macosDir = join(appPath, "Contents", "MacOS");
  const target = executable === null ? null : join(macosDir, executable);
  return result.stdout.split("\n").some((line) => {
    const value = line.trim();
    if (value.length === 0) return false;
    if (target !== null) return value === target;
    return value.startsWith(`${macosDir}/`);
  });
}

/**
 * Política em duas camadas:
 *  - codesign --verify --strict (integridade) falhou  → bloqueia
 *  - sem assinatura Apple/notarização (spctl)         → avisa e pede confirmação
 */
export async function assessAppSignature(path: string): Promise<SignatureAssessment> {
  const display = await run(["codesign", "-dv", "--verbose=4", path]);
  const displayText = `${display.stdout}\n${display.stderr}`;
  const notSigned = /code object is not signed at all/i.test(displayText);
  const signaturePresent = /^\s*Signature(?:=|\s+size=)/m.test(displayText);
  const teamMatch = /^\s*TeamIdentifier=(.+)$/m.exec(displayText);
  const authorityMatch = /^\s*Authority=(.+)$/m.exec(displayText);
  const signed = !notSigned && (signaturePresent || authorityMatch !== null);
  const teamId = teamMatch?.[1] !== undefined && teamMatch[1].trim() !== "not set" ? teamMatch[1].trim() : null;
  const authority = authorityMatch?.[1]?.trim() ?? null;

  const verify = await run(["codesign", "--verify", "--strict", path]);
  const integrityOk = verify.code === 0;

  const spctl = await run(["spctl", "-a", "-vvv", "-t", "exec", path]);
  const spctlText = `${spctl.stdout}\n${spctl.stderr}`;
  const accepted = spctl.code === 0;
  const notarized = accepted && /notarized/i.test(spctlText);

  const details = [
    `codesign: ${verify.code === 0 ? "ok" : "falhou"}`,
    `spctl: ${accepted ? "aceito" : "rejeitado"}`,
    authority !== null ? `autoridade: ${authority}` : null,
    teamId !== null ? `team: ${teamId}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("; ");

  return { integrityOk, signed, notarized, teamId, authority, details };
}

export function describeArchs(archs: string[] | null): string | null {
  if (archs === null || archs.length === 0) return null;
  if (archs.length > 1) return "universal";
  return archs[0] ?? null;
}
