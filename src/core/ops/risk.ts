import { AmbiguityError, SecurityError } from "../errors.ts";
import { ui } from "../output.ts";
import { confirm } from "../prompts.ts";
import { createStyle, type Style } from "../style.ts";
import { canPrompt, type Ctx } from "./context.ts";

export interface RiskContext {
  ctx: Ctx;
  /** Nomes dos overrides aceitos, registrados no item. */
  overrides: string[];
  notes: string[];
  warnings: string[];
}

export interface RiskRow {
  label: string;
  value: string;
}

/**
 * Aviso de risco estruturado para stderr (instalação interativa).
 * `flatMessage` é a forma compacta para SecurityError, dry-run e logs.
 */
export interface RiskNotice {
  override: string;
  /** Título curto, ex.: "assinatura inválida". */
  headline: string;
  app?: string | null;
  /** Onde a checagem falhou, ex.: "integridade (codesign --verify --strict)". */
  check?: string | null;
  /** Resultado da checagem, ex.: "falhou". */
  outcome?: string | null;
  rows?: RiskRow[];
  /** Mensagem compacta (obrigatória para erros não interativos). */
  flatMessage: string;
}

export function riskNoticeFromMessage(message: string, override: string): RiskNotice {
  return { override, headline: message, flatMessage: message };
}

export function formatRiskNotice(notice: RiskNotice, style: Style = createStyle()): string {
  const lines: string[] = [];
  lines.push(`${style.yellow("aviso:")} risco — ${style.bold(notice.headline)}`);
  const body: RiskRow[] = [];
  if (notice.app) body.push({ label: "app", value: notice.app });
  if (notice.check) body.push({ label: "checagem", value: notice.check });
  if (notice.outcome) body.push({ label: "resultado", value: notice.outcome });
  for (const row of notice.rows ?? []) body.push(row);
  if (body.length > 0) {
    const labelWidth = Math.max(...body.map((row) => row.label.length));
    for (const row of body) {
      const label = style.dim(row.label.padEnd(labelWidth));
      const value = colorizeRiskValue(row.label, row.value, style);
      lines.push(`  ${label}  ${value}`);
    }
  }
  return lines.join("\n");
}

function colorizeRiskValue(label: string, value: string, style: Style): string {
  const lower = value.toLowerCase();
  if (label === "app") return style.bold(value);
  if (label === "resultado" || lower === "falhou" || lower === "rejeitado" || lower.includes("inválid")) {
    return style.red(value);
  }
  if (lower === "aceito" || lower === "ok" || lower === "passou") return style.green(value);
  return value;
}

export function printRiskNotice(notice: RiskNotice): void {
  ui.endProgress();
  process.stderr.write(`${formatRiskNotice(notice)}\n`);
}

/**
 * Aceite explícito de risco: em `--dry-run` vira nota; com `--allow-unverified`
 * é aceito e registrado; interativamente pede confirmação; caso contrário falha
 * com código de segurança. `--yes` e `--json` nunca concedem.
 */
export async function requireRiskAcceptance(
  ctx: Ctx,
  notice: RiskNotice,
  overrides: string[],
): Promise<void> {
  if (ctx.opts.allowUnverified) {
    if (!overrides.includes(notice.override)) overrides.push(notice.override);
    printRiskNotice(notice);
    ui.warn(`aceito por --allow-unverified (override: ${notice.override})`);
    return;
  }
  if (canPrompt(ctx)) {
    printRiskNotice(notice);
    const ok = await confirm("Continuar?");
    if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");
    if (!overrides.includes(notice.override)) overrides.push(notice.override);
    return;
  }
  throw new SecurityError(notice.flatMessage, {
    hint: "confirme em um terminal interativo ou use --allow-unverified (fica registrado no item)",
  });
}

export async function requireOrNote(
  risk: RiskContext,
  messageOrNotice: string | RiskNotice,
  overrideName?: string,
): Promise<void> {
  const notice =
    typeof messageOrNotice === "string"
      ? riskNoticeFromMessage(messageOrNotice, overrideName ?? "unverified")
      : messageOrNotice;
  if (risk.ctx.opts.dryRun) {
    risk.notes.push(`exigirá aceite explícito (--allow-unverified): ${notice.flatMessage}`);
    return;
  }
  await requireRiskAcceptance(risk.ctx, notice, risk.overrides);
}

/** Nota em dry-run, aviso fora dele (para situações que não exigem aceite). */
export function noteOrWarn(risk: RiskContext, message: string): void {
  if (risk.ctx.opts.dryRun) risk.notes.push(message);
  else risk.warnings.push(message);
}

/** Aceite de escolha explícita que não é risco de segurança (ex.: arquitetura). */
export async function requireChoiceAcceptance(
  ctx: Ctx,
  message: string,
  overrideName: string,
  overrides: string[],
): Promise<void> {
  await requireRiskAcceptance(ctx, riskNoticeFromMessage(message, overrideName), overrides);
}

/**
 * Aceite de incompatibilidade de arquitetura: `--allow-arch-mismatch` é a flag
 * específica; `--allow-unverified` continua valendo (é mais ampla).
 */
export async function requireArchAcceptance(risk: RiskContext, message: string): Promise<void> {
  const ctx = risk.ctx;
  const notice: RiskNotice = {
    override: "arch-mismatch",
    headline: "arquitetura incompatível / sem build nativo",
    check: "arquitetura do artefato × máquina",
    outcome: "requer aceite",
    rows: [{ label: "detalhe", value: message }],
    flatMessage: message,
  };
  if (ctx.opts.dryRun) {
    risk.notes.push(`exigirá aceite explícito (--allow-arch-mismatch): ${message}`);
    return;
  }
  if (ctx.opts.allowArchMismatch || ctx.opts.allowUnverified) {
    if (!risk.overrides.includes("arch-mismatch")) risk.overrides.push("arch-mismatch");
    printRiskNotice(notice);
    ui.warn(
      `aceito por ${ctx.opts.allowArchMismatch ? "--allow-arch-mismatch" : "--allow-unverified"} (override: arch-mismatch)`,
    );
    return;
  }
  if (canPrompt(ctx)) {
    printRiskNotice(notice);
    const ok = await confirm("Continuar?");
    if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");
    if (!risk.overrides.includes("arch-mismatch")) risk.overrides.push("arch-mismatch");
    return;
  }
  throw new SecurityError(message, {
    hint: "confirme em um terminal interativo ou use --allow-arch-mismatch (fica registrado no item)",
  });
}

export async function confirmDecision(ctx: Ctx, reason: string): Promise<void> {
  if (!canPrompt(ctx)) {
    throw new AmbiguityError(reason, { hint: "confirme em um terminal interativo (sem --yes) ou ajuste as flags" });
  }
  const ok = await confirm(`${reason}. Continuar?`);
  if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");
}
