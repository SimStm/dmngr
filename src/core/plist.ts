import { StateError } from "./errors.ts";
import { run } from "./process.ts";

/**
 * Converte plists (XML ou binários) para JSON usando o plutil do sistema.
 * Evita dependência de parser de plist próprio.
 */
export async function plistToJsonFromFile<T = unknown>(file: string): Promise<T> {
  const result = await run(["plutil", "-convert", "json", "-o", "-", "--", file]);
  if (result.code !== 0) {
    throw new StateError(`não foi possível ler o plist: ${file}`, {
      details: (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-4).join("\n"),
    });
  }
  return parseJson<T>(result.stdout, file);
}

export async function plistToJsonFromText<T = unknown>(text: string): Promise<T> {
  const result = await run(["plutil", "-convert", "json", "-o", "-", "--", "-"], { stdin: text });
  if (result.code !== 0) {
    throw new StateError("não foi possível interpretar o plist", {
      details: (result.stderr.trim() || result.stdout.trim()).split("\n").slice(-4).join("\n"),
    });
  }
  return parseJson<T>(result.stdout, "<stdin>");
}

function parseJson<T>(raw: string, source: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new StateError(`plist convertido não é JSON válido: ${source}`, { cause: error });
  }
}
