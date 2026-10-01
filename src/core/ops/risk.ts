import { AmbiguityError, SecurityError } from "../errors.ts";
import { ui } from "../output.ts";
import { confirm } from "../prompts.ts";
import { canPrompt, type Ctx } from "./context.ts";

export interface RiskContext {
  ctx: Ctx;
  /** Nomes dos overrides aceitos, registrados no item. */
  overrides: string[];
  notes: string[];
  warnings: string[];
}

/**
 * Aceite explícito de risco: em `--dry-run` vira nota; com `--allow-unverified`
 * é aceito e registrado; interativamente pede confirmação; caso contrário falha
 * com código de segurança. `--yes` e `--json` nunca concedem.
 */
export async function requireRiskAcceptance(
  ctx: Ctx,
  message: string,
  overrideName: string,
  overrides: string[],
): Promise<void> {
  if (ctx.opts.allowUnverified) {
    overrides.push(overrideName);
    ui.warn(`${message} — aceito por --allow-unverified`);
    return;
  }
  if (canPrompt(ctx)) {
    const ok = await confirm(`${message}. Continuar?`);
    if (!ok) throw new AmbiguityError("operação cancelada pelo usuário");
    overrides.push(overrideName);
    return;
  }
  throw new SecurityError(message, {
    hint: "confirme em um terminal interativo ou use --allow-unverified (fica registrado no item)",
  });
}

export async function requireOrNote(risk: RiskContext, message: string, overrideName: string): Promise<void> {
  if (risk.ctx.opts.dryRun) {
    risk.notes.push(`exigirá aceite explícito (--allow-unverified): ${message}`);
    return;
  }
  await requireRiskAcceptance(risk.ctx, message, overrideName, risk.overrides);
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
  await requireRiskAcceptance(ctx, message, overrideName, overrides);
}

/**
 * Aceite de incompatibilidade de arquitetura: `--allow-arch-mismatch` é a flag
 * específica; `--allow-unverified` continua valendo (é mais ampla).
 */
export async function requireArchAcceptance(risk: RiskContext, message: string): Promise<void> {
  const ctx = risk.ctx;
  if (ctx.opts.dryRun) {
    risk.notes.push(`exigirá aceite explícito (--allow-arch-mismatch): ${message}`);
    return;
  }
  if (ctx.opts.allowArchMismatch || ctx.opts.allowUnverified) {
    if (!risk.overrides.includes("arch-mismatch")) risk.overrides.push("arch-mismatch");
    ui.warn(`${message} — aceito por ${ctx.opts.allowArchMismatch ? "--allow-arch-mismatch" : "--allow-unverified"}`);
    return;
  }
  if (canPrompt(ctx)) {
    const ok = await confirm(`${message}. Continuar?`);
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
