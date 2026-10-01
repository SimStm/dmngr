export interface ParsedVersion {
  core: number[];
  pre: string[] | null;
  raw: string;
}

/**
 * Comparação de versões tolerante a formatos comuns de CFBundleShortVersionString
 * e tags de release. Retorna null quando não é possível comparar com segurança
 * (nesse caso nunca declaramos update_available/up_to_date).
 */
export function parseVersion(input: string | null | undefined): ParsedVersion | null {
  if (typeof input !== "string") return null;
  let value = input.trim();
  if (value.length === 0) return null;
  value = value.replace(/^[vV](?=\d)/, "");
  value = value.replace(/\s+/g, "");
  const withoutBuild = value.split("+")[0] ?? value;
  const dashIndex = withoutBuild.indexOf("-");
  const corePart = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prePart = dashIndex === -1 ? null : withoutBuild.slice(dashIndex + 1);

  const core: number[] = [];
  for (const segment of corePart.split(".")) {
    if (!/^\d+$/.test(segment)) return null;
    core.push(Number.parseInt(segment, 10));
  }
  if (core.length === 0) return null;

  let pre: string[] | null = null;
  if (prePart !== null) {
    pre = prePart.split(".").filter((segment) => segment.length > 0);
    if (pre.length === 0) return null;
  }
  return { core, pre, raw: input };
}

export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (parsedA === null || parsedB === null) return null;

  const length = Math.max(parsedA.core.length, parsedB.core.length);
  for (let index = 0; index < length; index += 1) {
    const left = parsedA.core[index] ?? 0;
    const right = parsedB.core[index] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }

  const preA = parsedA.pre;
  const preB = parsedB.pre;
  if (preA === null && preB === null) return 0;
  if (preA === null) return 1; // 1.0.0 > 1.0.0-beta
  if (preB === null) return -1;

  const preLength = Math.max(preA.length, preB.length);
  for (let index = 0; index < preLength; index += 1) {
    const left = preA[index];
    const right = preB[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number.parseInt(left, 10);
      const rightNumber = Number.parseInt(right, 10);
      if (leftNumber !== rightNumber) return leftNumber < rightNumber ? -1 : 1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

export function isNewerVersion(candidate: string | null | undefined, current: string | null | undefined): boolean {
  return compareVersions(candidate, current) === 1;
}

/** Normaliza tags de release ("v1.2.3" → "1.2.3"); null quando a tag não é versão. */
export function normalizeTag(tag: string): string | null {
  const stripped = tag.trim().replace(/^[vV](?=\d)/, "");
  return parseVersion(stripped) === null ? null : stripped;
}

/**
 * Só comparamos tag de release com versão do app quando esse mapeamento já foi
 * observado e validado para o item (tag comparável).
 */
export function tagMapsToVersion(tag: string, appVersion: string | null): boolean {
  if (appVersion === null) return false;
  const normalized = normalizeTag(tag);
  if (normalized === null) return false;
  return compareVersions(normalized, appVersion) === 0;
}

export function looksLikeVersion(value: string | null | undefined): boolean {
  return parseVersion(value) !== null;
}
