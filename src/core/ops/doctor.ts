import { dirname } from "node:path";
import { hasCommand } from "../process.ts";
import { pathExists } from "../fsx.ts";
import { listDir } from "../fsx.ts";
import { listAttachedImages } from "../install/dmg.ts";
import { stagingArtifacts } from "../install/app-swap.ts";
import { lockPath, stateDir, tmpDir } from "../paths.ts";
import { readTextFile } from "../fsx.ts";
import { loadRegistry } from "../registry/store.ts";
import { loadConfig } from "../config.ts";
import { toDmngrError } from "../errors.ts";
import { readLiveItemInfo } from "./live.ts";
import { humanArch, machineArch, macOSVersion, rosettaAvailable } from "../system.ts";
import { formatArch, slugify } from "./item.ts";

export interface DoctorIssue {
  level: "ok" | "info" | "warn" | "error";
  area: string;
  message: string;
  hint?: string;
}

const REQUIRED_TOOLS = ["hdiutil", "ditto", "installer", "pkgutil", "plutil", "codesign", "spctl", "ps"];
const OPTIONAL_TOOLS = ["osascript", "lipo", "shasum"];

export async function runDoctor(): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];

  const systemVersion = await macOSVersion();
  issues.push({
    level: "ok",
    area: "ambiente",
    message: `macOS ${systemVersion ?? "versão desconhecida"} · ${humanArch(machineArch())}${(await rosettaAvailable()) ? " · Rosetta 2 disponível" : ""}`,
  });

  for (const tool of REQUIRED_TOOLS) {
    if (!hasCommand(tool)) {
      issues.push({
        level: "error",
        area: "ferramentas",
        message: `ferramenta obrigatória ausente: ${tool}`,
        hint: "instale as Command Line Tools (xcode-select --install)",
      });
    }
  }
  for (const tool of OPTIONAL_TOOLS) {
    if (!hasCommand(tool)) {
      issues.push({
        level: "warn",
        area: "ferramentas",
        message: `ferramenta opcional ausente: ${tool}`,
        hint: "alguns fluxos (elevação por diálogo, arquitetura) podem ficar limitados",
      });
    }
  }

  try {
    const config = await loadConfig();
    issues.push({
      level: "ok",
      area: "config",
      message: `configuração carregada (destino: ${config.destinationAppDir ?? "padrão /Applications"}, elevate: ${config.elevate})`,
    });
  } catch (error) {
    issues.push({ level: "error", area: "config", message: toDmngrError(error).message });
  }

  try {
    const registry = await loadRegistry();
    issues.push({ level: "ok", area: "registro", message: `${registry.items.length} item(ns) registrados em ${stateDir()}` });

    for (const item of registry.items) {
      if (item.installedPath !== null && !(await pathExists(item.installedPath))) {
        issues.push({
          level: "warn",
          area: "itens",
          message: `${item.id}: não existe mais em ${item.installedPath}`,
          hint: "o app pode ter sido movido ou removido por outro processo; o dmngr não remove o item automaticamente",
        });
        continue;
      }
      if (item.installedPath === null) {
        issues.push({
          level: "info",
          area: "itens",
          message: `${item.id}: sem caminho instalado registrado (kind ${item.kind}, versão ${item.installedVersion ?? "desconhecida"})`,
        });
      }
      const live = await readLiveItemInfo(item);
      for (const note of live.notes) {
        issues.push({ level: "info", area: "itens", message: `${item.id}: ${note}` });
      }
      if (live.installedExists && live.installedVersion !== item.installedVersion) {
        issues.push({
          level: "info",
          area: "itens",
          message: `${item.id}: versão registrada ${item.installedVersion ?? "desconhecida"}, versão atual no disco ${live.installedVersion ?? "desconhecida"}`,
          hint: "o app pode se auto-atualizar; a versão é relida em info/check/update",
        });
      }
      if (item.arch === null && item.kind === "app") {
        issues.push({ level: "info", area: "itens", message: `${item.id}: arquitetura desconhecida` });
      } else if (item.arch !== null) {
        issues.push({ level: "ok", area: "itens", message: `${item.id}: arquitetura ${formatArch(item.arch) ?? item.arch}` });
      }
      if (item.weakIdentity) {
        issues.push({
          level: "warn",
          area: "itens",
          message: `${item.id}: identidade fraca (sem bundle id/identificador)`,
          hint: "atualizações não serão associadas automaticamente",
        });
      }
      if (item.source.kind === "signed-url" || item.source.kind === "local-file" || item.source.kind === "unknown") {
        issues.push({
          level: "info",
          area: "itens",
          message: `${item.id}: origem não rastreável (${item.source.kind})`,
          hint: `atualize com: dmngr update ${item.id} --url <url>`,
        });
      }

      if (item.installedPath !== null) {
        const dir = dirname(item.installedPath);
        const leftovers = await stagingArtifacts(dir);
        if (leftovers.length > 0) {
          issues.push({
            level: "warn",
            area: "limpeza",
            message: `${item.id}: artefatos de staging/backup em ${dir}: ${leftovers.map((entry) => entry.split("/").pop()).join(", ")}`,
            hint: "verifique se o app atual está íntegro antes de apagar esses diretórios",
          });
        }
      }
      if (item.verification.overrides.length > 0) {
        issues.push({
          level: "warn",
          area: "segurança",
          message: `${item.id}: instalado com overrides: ${item.verification.overrides.join(", ")}`,
        });
      }
    }
  } catch (error) {
    const dmngrError = toDmngrError(error);
    issues.push({
      level: "error",
      area: "registro",
      message: dmngrError.message,
      hint: dmngrError.hint,
    });
  }

  if (await pathExists(lockPath())) {
    let owner = "desconhecido";
    try {
      const raw = await readTextFile(lockPath());
      const parsed = JSON.parse(raw) as { pid?: number; startedAt?: string };
      owner = `pid ${parsed.pid ?? "?"} desde ${parsed.startedAt ?? "?"}`;
    } catch {
      /* lock ilegível */
    }
    issues.push({
      level: "warn",
      area: "lock",
      message: `lock presente em ${lockPath()} (${owner})`,
      hint: "se não houver outro dmngr rodando, remova o arquivo",
    });
  }

  const images = await listAttachedImages();
  const ours = images.filter((image) => image.imagePath.startsWith(tmpDir()) || image.imagePath.startsWith(stateDir()));
  for (const image of ours) {
    issues.push({
      level: "warn",
      area: "montagens",
      message: `imagem ainda montada: ${image.imagePath} em ${image.mountPoints.join(", ") || "(sem ponto)"}`,
      hint: `desmonte com: hdiutil detach ${image.devEntries[0] ?? "<dev>"}`,
    });
  }
  const foreign = images.filter((image) => image.imagePath.startsWith("/Volumes"));
  for (const image of foreign) {
    issues.push({
      level: "info",
      area: "montagens",
      message: `imagem externa montada: ${image.imagePath}`,
    });
  }

  const tmpEntries = await listDir(tmpDir());
  if (tmpEntries.length > 0) {
    issues.push({
      level: "info",
      area: "temporários",
      message: `${tmpEntries.length} entrada(s) em ${tmpDir()}`,
      hint: "seguro apagar quando não houver operação em andamento",
    });
  }

  if (issues.every((issue) => issue.level === "ok" || issue.level === "info")) {
    issues.push({ level: "ok", area: "resumo", message: "nenhum problema encontrado" });
  }
  return issues;
}

export function doctorIssueRank(level: DoctorIssue["level"]): number {
  return { ok: 0, info: 1, warn: 2, error: 3 }[level];
}

export function summarizeDoctor(issues: DoctorIssue[]): { ok: number; info: number; warn: number; error: number } {
  const summary = { ok: 0, info: 0, warn: 0, error: 0 };
  for (const issue of issues) summary[issue.level] += 1;
  return summary;
}

export const doctorSlug = slugify;
