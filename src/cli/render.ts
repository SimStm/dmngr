import { describeArchs } from "../core/inspect/app-bundle.ts";
import type { CheckRow } from "../core/ops/check.ts";
import type { DoctorIssue } from "../core/ops/doctor.ts";
import type { LiveItemInfo } from "../core/ops/live.ts";
import type { RegistryItem } from "../core/registry/schema.ts";
import { pathExists } from "../core/fsx.ts";
import { formatBytes } from "../core/input/download.ts";

export function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return headers.join("  ");
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)),
  );
  const format = (cells: string[]): string =>
    cells
      .map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  const separator = headers.map((header) => "-".repeat(header.length));
  return [format(headers), format(separator), ...rows.map((row) => format(row))].join("\n");
}

export interface ListRow {
  item: RegistryItem;
  state: "ok" | "missing" | "unknown-version";
}

export async function buildListRows(items: RegistryItem[]): Promise<ListRow[]> {
  const rows: ListRow[] = [];
  for (const item of items) {
    let state: ListRow["state"] = "ok";
    if (item.installedPath !== null && !(await pathExists(item.installedPath))) state = "missing";
    else if (item.installedVersion === null) state = "unknown-version";
    rows.push({ item, state });
  }
  return rows;
}

export function listRowJson(row: ListRow): Record<string, unknown> {
  const { item } = row;
  return {
    id: item.id,
    displayName: item.displayName,
    kind: item.kind,
    artifactType: item.artifactType,
    installedPath: item.installedPath,
    installedVersion: item.installedVersion,
    buildVersion: item.buildVersion,
    versionEvidence: item.versionEvidence,
    state: row.state,
    weakIdentity: item.weakIdentity,
    arch: item.arch,
    source: {
      kind: item.source.kind,
      repository: item.source.repository,
      assetPattern: item.source.assetPattern,
      channel: item.source.channel,
      url: item.source.resolvedUrl,
      releaseTag: item.artifact.releaseTag,
    },
    lastCheckedAt: item.lastCheckedAt,
    lastResult: item.lastResult,
    previousVersion: item.previousVersion,
    updatedAt: item.updatedAt,
  };
}

export function renderListTable(rows: ListRow[]): string {
  const table = renderTable(
    ["ID", "NOME", "TIPO", "VERSÃO", "ESTADO", "ORIGEM"],
    rows.map((row) => [
      row.item.id,
      row.item.displayName,
      `${row.item.kind}/${row.item.artifactType}`,
      row.item.installedVersion ?? "—",
      row.state === "ok" ? "ok" : row.state === "missing" ? "ausente" : "sem versão",
      describeItemSource(row.item),
    ]),
  );
  if (rows.length === 0) return `${table}\n(nenhum item gerenciado; use \`dmngr install <url|arquivo>\`)`;
  return table;
}

export function describeItemSource(item: RegistryItem): string {
  const source = item.source;
  if (source.repository !== null) {
    const tag = item.artifact.releaseTag ?? source.tagComparable?.tag ?? null;
    return `github ${source.repository}${tag === null ? "" : `@${tag}`}`;
  }
  if (source.resolvedUrl !== null) return source.resolvedUrl;
  if (source.kind === "local-file") return "arquivo local";
  return source.kind;
}

export function infoJson(item: RegistryItem, live: LiveItemInfo): Record<string, unknown> {
  const drift = live.installedVersion !== item.installedVersion;
  return {
    schemaVersion: 1,
    item: {
      ...item,
      live: {
        installedExists: live.installedExists,
        installedVersion: live.installedVersion,
        buildVersion: live.buildVersion,
        bundleId: live.bundleId,
        arch: live.arch,
        drift,
        notes: live.notes,
      },
    },
  };
}

export function renderInfo(item: RegistryItem, live: LiveItemInfo): void {
  const lines: string[] = [];
  lines.push(`${item.displayName} — ${item.id}`);
  lines.push(`  tipo: ${item.kind} (${item.artifactType})`);
  if (item.bundleId !== null) lines.push(`  bundle id: ${item.bundleId}`);
  if (item.installedPath !== null) lines.push(`  instalado em: ${item.installedPath}${live.installedExists ? "" : " (não existe mais)"}`);
  lines.push(`  versão registrada: ${item.installedVersion ?? "desconhecida"} (evidência: ${item.versionEvidence})`);
  if (live.installedVersion !== item.installedVersion) {
    lines.push(`  versão atual no disco: ${live.installedVersion ?? "desconhecida"}`);
  }
  if (item.buildVersion !== null) lines.push(`  build: ${item.buildVersion}`);
  if (item.arch !== null) lines.push(`  arquitetura: ${describeArchs(item.arch.split(/\s+/)) ?? item.arch}`);
  lines.push(`  origem: ${describeItemSource(item)} (${item.source.kind})`);
  if (item.source.resolvedUrl !== null) lines.push(`  url: ${item.source.resolvedUrl}`);
  if (item.artifact.sha256 !== null) lines.push(`  sha256: ${item.artifact.sha256}`);
  if (item.artifact.fileName !== null) {
    lines.push(`  arquivo: ${item.artifact.fileName}${item.artifact.size === null ? "" : ` (${formatBytes(item.artifact.size)})`}`);
  }
  lines.push(`  instalado em: ${item.installedAt} · atualizado em: ${item.updatedAt}`);
  lines.push(`  última checagem: ${item.lastCheckedAt ?? "nunca"} · último resultado: ${item.lastResult ?? "—"}`);
  if (item.previousVersion !== null) lines.push(`  versão anterior: ${item.previousVersion}`);
  lines.push(
    `  verificação: assinatura=${formatFlag(item.verification.signed)} · notarização=${formatFlag(item.verification.notarized)} · integridade=${formatFlag(item.verification.integrityOk)}${item.verification.teamId === null ? "" : ` · team ${item.verification.teamId}`}`,
  );
  if (item.verification.overrides.length > 0) lines.push(`  overrides aceitos: ${item.verification.overrides.join(", ")}`);
  if (item.receipts.length > 0) {
    lines.push(`  receipts: ${item.receipts.map((receipt) => `${receipt.identifier}${receipt.version === null ? "" : `@${receipt.version}`}${receipt.installed ? "" : " (ausente)"}`).join(", ")}`);
  }
  if (item.observedApps.length > 0) {
    lines.push(`  apps observados: ${item.observedApps.map((app) => `${app.path}${app.version === null ? "" : ` (${app.version})`}`).join(", ")}`);
  }
  if (item.aliases.length > 0) lines.push(`  aliases: ${item.aliases.join(", ")}`);
  if (item.weakIdentity) lines.push("  identidade fraca: atualizações não são associadas automaticamente");
  for (const note of live.notes) lines.push(`  · ${note}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

function formatFlag(value: boolean | null): string {
  if (value === null) return "desconhecido";
  return value ? "sim" : "não";
}

export function checkRowJson(row: CheckRow): Record<string, unknown> {
  return {
    id: row.id,
    displayName: row.displayName,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    evidence: row.evidence,
    installedVersion: row.installedVersion,
    localVersion: row.localVersion,
    availableVersion: row.availableVersion,
    releaseTag: row.releaseTag,
    drift: row.drift,
    missingLocal: row.missingLocal,
    hint: row.hint,
    candidates: row.candidates,
  };
}

export function renderCheckTable(rows: CheckRow[]): void {
  const table = renderTable(
    ["ID", "STATUS", "INSTALADO", "DISPONÍVEL", "EVIDÊNCIA"],
    rows.map((row) => [
      row.id,
      row.status,
      row.installedVersion ?? "—",
      row.availableVersion ?? "—",
      row.evidence,
    ]),
  );
  process.stdout.write(`${table}\n`);
  for (const row of rows) {
    const details: string[] = [];
    if (row.drift) details.push(`versão no disco difere do registro (${row.localVersion ?? "desconhecida"})`);
    if (row.missingLocal) details.push("o app não está mais no caminho registrado");
    if (row.hint !== undefined) details.push(row.hint);
    if (row.candidates !== undefined && row.candidates.length > 0) {
      details.push(`candidatos: ${row.candidates.join(", ")}`);
    }
    if (details.length > 0) process.stdout.write(`  ${row.id}: ${details.join(" · ")}\n`);
  }
}

export function renderUpdateAll(rows: { id: string; displayName: string; result: string; note: string }[]): void {
  const table = renderTable(
    ["ID", "RESULTADO", "DETALHE"],
    rows.map((row) => [row.id, row.result, row.note]),
  );
  process.stdout.write(`${table}\n`);
}

export function renderDoctor(issues: DoctorIssue[]): void {
  const symbols: Record<DoctorIssue["level"], string> = { ok: "ok", info: "info", warn: "aviso", error: "erro" };
  for (const issue of issues) {
    process.stdout.write(`[${symbols[issue.level]}] ${issue.area}: ${issue.message}\n`);
    if (issue.hint !== undefined) process.stdout.write(`        → ${issue.hint}\n`);
  }
}
