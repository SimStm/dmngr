import { run } from "./process.ts";

/**
 * Conhecimento de plataforma: arquitetura da máquina, versão do macOS e
 * classificação/compatibilidade de arquitetura de artefatos.
 *
 * As funções de classificação são puras; `machineArch()` é o único estado do
 * processo e pode ser injetado nas funções de seleção para testes.
 */
export type MachineArch = "arm64" | "x64";
export type AssetArch = "arm64" | "x64" | "universal" | "unknown";
export type ArchCompatibility = "ok" | "needs-rosetta" | "impossible" | "unknown";

export const ARM64_TOKENS = [
  "arm64",
  "aarch64",
  "apple-silicon",
  "apple_silicon",
  "silicon",
  "m1",
  "m2",
  "m3",
  "m4",
];

export const X64_TOKENS = ["x86_64", "x86-64", "x64", "amd64", "intel", "i386"];

export const UNIVERSAL_TOKENS = ["universal", "univ", "fat", "multi-arch", "all-arch"];

export function machineArch(): MachineArch {
  return process.arch === "arm64" ? "arm64" : "x64";
}

export function humanArch(arch: MachineArch): string {
  return arch === "arm64" ? "arm64 (Apple Silicon)" : "x64 (Intel)";
}

export function describeAssetArch(arch: AssetArch): string {
  switch (arch) {
    case "arm64":
      return "arm64 (Apple Silicon)";
    case "x64":
      return "x64 (Intel)";
    case "universal":
      return "universal";
    default:
      return "não identificada";
  }
}

let cachedMacOSVersion: string | null | undefined;

export async function macOSVersion(): Promise<string | null> {
  if (cachedMacOSVersion !== undefined) return cachedMacOSVersion;
  const result = await run(["sw_vers", "-productVersion"]);
  cachedMacOSVersion = result.code === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
  return cachedMacOSVersion;
}

let cachedRosetta: boolean | undefined;

/** `arch -x86_64 /usr/bin/true` só funciona quando o Rosetta 2 está disponível. */
export async function rosettaAvailable(): Promise<boolean> {
  if (machineArch() === "x64") return true;
  if (cachedRosetta !== undefined) return cachedRosetta;
  const result = await run(["arch", "-x86_64", "/usr/bin/true"]);
  cachedRosetta = result.code === 0;
  return cachedRosetta;
}

export function resetSystemCache(): void {
  cachedMacOSVersion = undefined;
  cachedRosetta = undefined;
}

function hasToken(name: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(name);
}

/** Classifica a arquitetura a partir do nome do arquivo/asset (heurística). */
export function classifyArchName(name: string): AssetArch {
  const universal = UNIVERSAL_TOKENS.some((token) => hasToken(name, token));
  const arm = ARM64_TOKENS.some((token) => hasToken(name, token));
  const x64 = X64_TOKENS.some((token) => hasToken(name, token));
  if (universal && !arm && !x64) return "universal";
  if (arm && x64) return "universal";
  if (arm || x64) return universal ? "universal" : arm ? "arm64" : "x64";
  return "unknown";
}

/** Classifica a partir das arquiteturas reais do bundle (`lipo -archs`). */
export function classifyArchList(archs: string[] | null): AssetArch {
  if (archs === null || archs.length === 0) return "unknown";
  const normalized = archs.map((arch) => arch.toLowerCase());
  const hasArm = normalized.some((arch) => arch === "arm64" || arch === "arm64e" || arch === "aarch64");
  const hasX64 = normalized.some((arch) => arch === "x86_64" || arch === "x64" || arch === "i386");
  if (hasArm && hasX64) return "universal";
  if (hasArm) return "arm64";
  if (hasX64) return "x64";
  return "unknown";
}

/**
 * Compatibilidade de um artefato com a máquina:
 *  - universal/unknown → ok (unknown é confirmado depois do download)
 *  - mesma arquitetura   → ok
 *  - x64 em arm64        → needs-rosetta (aceite explícito)
 *  - arm64 em x64        → impossible (não roda)
 */
export function archCompatibility(arch: AssetArch, machine: MachineArch): ArchCompatibility {
  if (arch === "universal") return "ok";
  if (arch === "unknown") return "unknown";
  if (arch === machine) return "ok";
  if (arch === "x64" && machine === "arm64") return "needs-rosetta";
  return "impossible";
}

export function archsCompatibility(archs: string[] | null, machine: MachineArch): ArchCompatibility {
  return archCompatibility(classifyArchList(archs), machine);
}

export function machineArchTokenPairs(machine: MachineArch): { preferred: AssetArch; other: AssetArch } {
  return machine === "arm64" ? { preferred: "arm64", other: "x64" } : { preferred: "x64", other: "arm64" };
}
