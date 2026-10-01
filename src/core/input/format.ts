import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathExists } from "../fsx.ts";

export type ArtifactFormat = "dmg" | "dmg-encrypted" | "pkg-flat" | "pkg-bundle" | "zip" | "unknown";

export interface ArtifactFormatInfo {
  format: ArtifactFormat;
  detail: string;
}

const ZIP_MAGIC_FIRST = 0x50;

/**
 * Detecção por conteúdo, não por extensão/Content-Type.
 *  - XAR ("xar!") = pacote flat do macOS
 *  - trailer "koly" = imagem UDIF (DMG); "encrcdsa" = DMG criptografado
 *  - "PK" = ZIP (não suportado no MVP)
 */
export async function detectFormat(path: string): Promise<ArtifactFormatInfo> {
  const stats = await stat(path);

  if (stats.isDirectory()) {
    if (
      (await pathExists(join(path, "Contents", "PkgInfo"))) ||
      (await pathExists(join(path, "Contents", "Archive.pax.gz"))) ||
      (await pathExists(join(path, "Contents", "Archive.bom")))
    ) {
      return { format: "pkg-bundle", detail: "pacote no formato bundle" };
    }
    return { format: "unknown", detail: "diretório sem formato de pacote reconhecido" };
  }

  const handle = await open(path, "r");
  try {
    const head = new Uint8Array(4);
    const headRead = await handle.read(head, 0, 4, 0);
    if (headRead.bytesRead >= 4) {
      const magic = String.fromCharCode(head[0] ?? 1, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0);
      if (magic === "xar!") return { format: "pkg-flat", detail: "pacote flat (XAR)" };
      if (ZIP_MAGIC_FIRST === head[0] && head[1] === 0x4b) return { format: "zip", detail: "arquivo ZIP" };
    }

    if (stats.size >= 512) {
      const tail = new Uint8Array(512);
      const tailRead = await handle.read(tail, 0, 512, stats.size - 512);
      if (tailRead.bytesRead >= 4) {
        const trailer = String.fromCharCode(tail[0] ?? 1, tail[1] ?? 0, tail[2] ?? 0, tail[3] ?? 0);
        if (trailer === "koly") return { format: "dmg", detail: "imagem de disco UDIF" };
        if (trailer === "encr") return { format: "dmg-encrypted", detail: "imagem de disco criptografada" };
      }
    }

    return { format: "unknown", detail: "formato não reconhecido" };
  } finally {
    await handle.close();
  }
}

export function isInstallableFormat(format: ArtifactFormat): boolean {
  return format === "dmg" || format === "pkg-flat" || format === "pkg-bundle";
}
