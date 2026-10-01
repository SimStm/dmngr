import { basename, dirname, extname, join } from "node:path";
import { resolveDestinationDirFor } from "../config.ts";
import { AmbiguityError, InstallError, SecurityError, UsageError } from "../errors.ts";
import { pathExists } from "../fsx.ts";
import { detectFormat } from "../input/format.ts";
import {
  assessAppSignature,
  isAppRunning,
  readAppBundle,
  type AppBundleInfo,
  type SignatureAssessment,
} from "../inspect/app-bundle.ts";
import { inspectPkg, payloadAppPaths, readReceipts } from "../inspect/pkg.ts";
import { installAppBundle, uniqueAppName } from "../install/app-swap.ts";
import { scanMountedImage, withMountedDmg, type DmgCandidate } from "../install/dmg.ts";
import { installPkg, observedAppsFromPayload } from "../install/pkg.ts";
import { ui } from "../output.ts";
import { chooseOne, isInteractive } from "../prompts.ts";
import { findItemsByIdentity, type ArtifactIdentity } from "../registry/resolve.ts";
import type { RegistryItem, SourceInfo, VerificationInfo, VersionEvidence } from "../registry/schema.ts";
import { loadRegistry, uniqueItemId, updateRegistry, upsertItem } from "../registry/store.ts";
import { normalizeTag, tagMapsToVersion } from "../versioning.ts";
import { canPrompt, effectiveElevate, type Ctx } from "./context.ts";
import { confirmDecision, requireArchAcceptance, requireOrNote, type RiskContext } from "./risk.ts";
import {
  archsCompatibility,
  classifyArchList,
  describeAssetArch,
  humanArch,
  machineArch,
  rosettaAvailable,
} from "../system.ts";
import { decideArtifactAction } from "./decide.ts";
import { archsOf, buildRegistryItem, sameArchs, slugify, type ItemDraft } from "./item.ts";

export interface ApplyParams {
  ctx: Ctx;
  /** Arquivo baixado ou local (dmg/pkg). */
  localPath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  source: SourceInfo;
  releaseTag: string | null;
  /** Item já identificado (updates); null em install (busca por identidade). */
  existingItem: RegistryItem | null;
  /** "install" = instalação nova; "identify" = associar por identidade; "require-existing" = exige item já registrado. */
  mode: "install" | "identify" | "require-existing";
  displayNameHint: string | null;
  assetName: string | null;
  /** Aceite já dado antes do download (asset x64 em arm64). */
  acceptedArchMismatch?: boolean;
  /** Overrides já aceitos antes do download (ex.: arch-mismatch), registrados no item. */
  preAcceptedOverrides?: string[];
}

export type ApplyAction = "installed" | "updated" | "noop" | "keep-both" | "planned";

export interface ApplyResult {
  action: ApplyAction;
  item: RegistryItem | null;
  installedPath: string | null;
  installedVersion: string | null;
  previousVersion: string | null;
  warnings: string[];
  notes: string[];
}

export async function applyArtifact(params: ApplyParams): Promise<ApplyResult> {
  const format = await detectFormat(params.localPath);
  if (format.format === "dmg-encrypted") {
    throw new InstallError("imagens de disco criptografadas não são suportadas", {
      hint: "descriptografe a imagem antes de instalar",
    });
  }
  if (format.format === "zip") {
    throw new InstallError("arquivos ZIP ainda não são suportados", {
      hint: "use o .dmg ou .pkg publicado pelo fornecedor",
    });
  }
  if (format.format === "unknown") {
    throw new InstallError(`formato não reconhecido: ${params.fileName}`, {
      hint: "o dmngr instala .dmg e .pkg; a extensão do arquivo não é confiável e o conteúdo não foi reconhecido",
    });
  }

  if (format.format === "dmg") {
    return await withMountedDmg(params.localPath, async (mount) => {
      const root = mount.mountPoints[0];
      if (root === undefined) throw new InstallError("a imagem foi montada sem ponto de montagem");
      const candidates = await scanMountedImage(root);
      if (candidates.length === 0) {
        throw new InstallError("nenhum .app ou .pkg instalável foi encontrado na imagem", {
          details: { mountPoints: mount.mountPoints },
        });
      }
      const chosen = await chooseCandidate(params, candidates);
      if (chosen.kind === "app") return await applyAppBundle(params, chosen.path);
      return await applyPkgArtifact(params, chosen.path);
    });
  }

  return await applyPkgArtifact(params, params.localPath);
}

// ---------------------------------------------------------------------------
// .app
// ---------------------------------------------------------------------------

async function applyAppBundle(params: ApplyParams, appPath: string): Promise<ApplyResult> {
  const { ctx } = params;
  const warnings: string[] = [];
  const notes: string[] = [];
  const overrides: string[] = [...(params.preAcceptedOverrides ?? [])];

  const risk: RiskContext = { ctx, overrides, notes, warnings };
  const app = await readAppBundle(appPath);
  const displayName = params.displayNameHint ?? app.name ?? basename(appPath, ".app");
  const identity: ArtifactIdentity = { bundleId: app.bundleId, pkgIdentifiers: [], displayName };
  const existing = params.existingItem ?? (params.mode === "install" ? null : await findExistingByIdentity(identity));
  if (params.mode === "require-existing" && existing === null) {
    throw new UsageError(`nenhum item registrado corresponde a este arquivo (${displayName})`, {
      hint: "use `dmngr install` para instalar como um item novo",
    });
  }

  if (existing !== null && params.mode === "identify") {
    notes.push(`item já registrado (${existing.displayName}); conduzindo como atualização`);
  }

  if (app.bundleId === null) {
    notes.push("o app não declara CFBundleIdentifier: identidade fraca");
    await requireOrNote(
      risk,
      `${displayName} não declara um identificador de bundle; atualizações automáticas por identidade não serão possíveis`,
      "weak-identity",
    );
  }

  const decision = decideArtifactAction({
    existing,
    candidateVersion: app.shortVersion,
    candidateSha256: params.sha256,
    reinstall: ctx.opts.reinstall,
  });
  if (ctx.opts.dryRun) {
    notes.push(`decisão: ${decision.reason}`);
    if (decision.action === "refuse") warnings.push(`seria recusado: ${decision.reason}`);
    if (decision.action === "confirm") notes.push("seria solicitada confirmação para prosseguir");
    if (decision.action === "noop") notes.push("nenhuma alteração seria feita (use --reinstall para forçar)");
  } else {
    if (decision.action === "refuse") {
      throw new InstallError(decision.reason, { hint: "downgrade não é aceito automaticamente" });
    }
    if (decision.action === "noop") {
      ui.info(decision.reason);
      return {
        action: "noop",
        item: existing,
        installedPath: existing?.installedPath ?? null,
        installedVersion: existing?.installedVersion ?? null,
        previousVersion: null,
        warnings,
        notes: [decision.reason, ...notes],
      };
    }
    if (decision.action === "confirm") await confirmDecision(ctx, decision.reason);
    else ui.info(decision.reason);
  }

  await checkBundleArchitecture(risk, app, displayName, params.acceptedArchMismatch === true);
  await checkIdentityAndArchChanges(risk, existing, app, displayName);

  const destinationDir = await resolveAppDestination(ctx, existing);
  if (ctx.opts.destination !== undefined && existing?.installedPath != null && dirname(existing.installedPath) !== destinationDir) {
    warnings.push(`o app será movido de ${dirname(existing.installedPath)} para ${destinationDir}`);
  }

  let targetName = basename(appPath);
  let keepBoth = false;
  const targetPath = join(destinationDir, targetName);
  if (await pathExists(targetPath)) {
    const occupant = await tryReadBundle(targetPath);
    const sameBundle =
      occupant !== null && occupant.bundleId !== null && app.bundleId !== null && occupant.bundleId === app.bundleId;
    if (!sameBundle) {
      if (!canPrompt(ctx)) {
        throw new AmbiguityError(`já existe um app diferente em ${targetPath}`, {
          hint: `escolha interativamente (substituir/manter ambos) ou use --destination`,
          details: { target: targetPath, occupyingBundleId: occupant?.bundleId ?? null },
        });
      }
      const alternativeName = await uniqueAppName(destinationDir, targetName);
      const choice = await chooseOne(`Já existe um app diferente em ${targetPath}.`, [
        { value: "replace", label: "substituir", description: `${targetName} será substituído (com backup temporário)` },
        { value: "keep", label: "manter ambos", description: `instalar como ${alternativeName} (novo item no registro)` },
        { value: "cancel", label: "cancelar" },
      ]);
      if (choice === "cancel") throw new AmbiguityError("operação cancelada pelo usuário");
      if (choice === "keep") {
        targetName = alternativeName;
        keepBoth = true;
      }
    }
  }

  const finalTarget = join(destinationDir, targetName);
  if (await isAppRunning(existing?.installedPath ?? finalTarget, app.executable)) {
    throw new InstallError(`${displayName} está em execução`, { hint: "feche o app e rode o comando novamente" });
  }

  if (ctx.opts.dryRun) {
    return {
      action: "planned",
      item: existing,
      installedPath: finalTarget,
      installedVersion: app.shortVersion,
      previousVersion: existing?.installedVersion ?? null,
      warnings,
      notes: [`destino: ${finalTarget}`, `versão do artefato: ${app.shortVersion ?? "desconhecida"}`, ...notes],
    };
  }

  let assessment: SignatureAssessment | null = null;
  const installResult = await installAppBundle({
    source: appPath,
    destinationDir,
    targetName,
    beforeCommit: async (stagedApp) => {
      const staged = await readAppBundle(stagedApp);
      if (app.bundleId !== null && staged.bundleId !== app.bundleId) {
        throw new InstallError("a cópia do app mudou de identidade durante a instalação", {
          details: { expected: app.bundleId, actual: staged.bundleId },
        });
      }
      if (app.shortVersion !== null && staged.shortVersion !== app.shortVersion) {
        throw new InstallError("a cópia do app não preservou a versão original", {
          details: { expected: app.shortVersion, actual: staged.shortVersion },
        });
      }
      const result = await assessAppSignature(stagedApp);
      assessment = result;
      if (!result.integrityOk) {
        throw new SecurityError(`a assinatura de ${displayName} é inválida (codesign --verify falhou)`, {
          hint: "o app pode ter sido adulterado; nada foi instalado",
          details: { assessment: result.details },
        });
      }
      if (!result.notarized) {
        await requireOrNote(risk, `${displayName} não tem assinatura notarizada pela Apple (${result.details})`, "unverified");
      }
    },
  });

  const tagComparable = computeTagComparable(params.releaseTag, app.shortVersion, warnings);
  const draft: ItemDraft = {
    kind: "app",
    artifactType: "dmg",
    baseId: app.bundleId ?? `app:${slugify(displayName)}`,
    displayName: keepBoth ? `${displayName} (cópia)` : displayName,
    aliases: [app.name ?? ""],
    bundleId: app.bundleId,
    installedPath: installResult.installedPath,
    installedVersion: app.shortVersion,
    buildVersion: app.buildVersion,
    versionEvidence: "bundle-info-plist",
    arch: app.archs?.join(" ") ?? null,
    weakIdentity: app.bundleId === null,
    source: { ...params.source, tagComparable },
    artifact: {
      sha256: params.sha256,
      size: params.sizeBytes,
      releaseTag: params.releaseTag,
      fileName: params.fileName,
    },
    receipts: [],
    observedApps: [{ path: installResult.installedPath, bundleId: app.bundleId, version: app.shortVersion }],
    verification: verificationFrom(assessment, overrides),
    lastResult: installResult.hadPrevious ? "updated" : "installed",
  };

  const item = await persistItem(draft, existing, keepBoth);
  ui.info(
    `${installResult.hadPrevious ? "atualizado" : "instalado"}: ${item.displayName} ${item.installedVersion ?? "(versão desconhecida)"} em ${item.installedPath}`,
  );
  return {
    action: keepBoth ? "keep-both" : installResult.hadPrevious ? "updated" : "installed",
    item,
    installedPath: item.installedPath,
    installedVersion: item.installedVersion,
    previousVersion: item.previousVersion,
    warnings,
    notes,
  };
}

// ---------------------------------------------------------------------------
// .pkg
// ---------------------------------------------------------------------------

async function applyPkgArtifact(params: ApplyParams, pkgPath: string): Promise<ApplyResult> {
  const { ctx } = params;
  const warnings: string[] = [];
  const notes: string[] = [];
  const overrides: string[] = [...(params.preAcceptedOverrides ?? [])];

  const risk: RiskContext = { ctx, overrides, notes, warnings };
  ui.info(`inspecionando pacote ${basename(pkgPath)}`);
  const pkg = await inspectPkg(pkgPath);
  const componentIds = pkg.components.map((component) => component.identifier);
  const declaredVersion = pkg.components.map((component) => component.version).find((version) => version !== null) ?? null;
  const appRefs = payloadAppPaths(pkg);
  const primaryApp = appRefs.find((ref) => ref.bundleId !== null) ?? null;
  const displayName = params.displayNameHint ?? pkg.title ?? pkg.components[0]?.identifier ?? basename(pkgPath);
  const identity: ArtifactIdentity = {
    bundleId: primaryApp?.bundleId ?? null,
    pkgIdentifiers: componentIds,
    displayName,
  };
  const existing = params.existingItem ?? (params.mode === "install" ? null : await findExistingByIdentity(identity));
  if (params.mode === "require-existing" && existing === null) {
    throw new UsageError(`nenhum item registrado corresponde a este pacote (${displayName})`, {
      hint: "use `dmngr install` para instalar como um item novo",
    });
  }

  notes.push(
    `componentes: ${pkg.components
      .map((component) => `${component.identifier}${component.version !== null ? `@${component.version}` : ""}`)
      .join(", ")}`,
  );
  if (pkg.components.some((component) => component.relocatable)) {
    warnings.push("o pacote é relocatable: o instalador pode reaproveitar um app já existente em outro caminho");
  }

  const decision = decideArtifactAction({
    existing,
    candidateVersion: declaredVersion,
    candidateSha256: params.sha256,
    reinstall: ctx.opts.reinstall,
  });
  if (ctx.opts.dryRun) {
    notes.push(`decisão: ${decision.reason}`);
    if (decision.action === "refuse") warnings.push(`seria recusado: ${decision.reason}`);
    if (decision.action === "confirm") notes.push("seria solicitada confirmação para prosseguir");
    if (decision.action === "noop") notes.push("nenhuma alteração seria feita (use --reinstall para forçar)");
  } else {
    if (decision.action === "refuse") {
      throw new InstallError(decision.reason, { hint: "downgrade não é aceito automaticamente" });
    }
    if (decision.action === "noop") {
      ui.info(decision.reason);
      return {
        action: "noop",
        item: existing,
        installedPath: existing?.installedPath ?? null,
        installedVersion: existing?.installedVersion ?? null,
        previousVersion: null,
        warnings,
        notes: [decision.reason, ...notes],
      };
    }
    if (decision.action === "confirm") await confirmDecision(ctx, decision.reason);
    else ui.info(decision.reason);
  }

  const scriptComponents = pkg.components.filter((component) => component.hasScripts).map((component) => component.identifier);
  if (scriptComponents.length > 0) {
    warnings.push(`o pacote executa scripts de instalação como root: ${scriptComponents.join(", ")}`);
    await requireOrNote(
      risk,
      `o pacote executa scripts de instalação como root (${scriptComponents.join(", ")}); esses scripts alteram o sistema fora do dmngr`,
      "pkg-scripts",
    );
  }

  if (!pkg.signature.signed) {
    await requireOrNote(risk, `${displayName} não tem assinatura verificável (${pkg.signature.statusSummary ?? "sem status"})`, "unverified");
  } else if (!pkg.signature.notarized) {
    await requireOrNote(
      risk,
      `${displayName} está assinado (${pkg.signature.authority ?? "autoridade desconhecida"}) mas não é notarizado`,
      "unverified",
    );
  }

  if (ctx.opts.dryRun) {
    return {
      action: "planned",
      item: existing,
      installedPath: existing?.installedPath ?? null,
      installedVersion: declaredVersion,
      previousVersion: existing?.installedVersion ?? null,
      warnings,
      notes: [`versão declarada pelo pacote: ${declaredVersion ?? "desconhecida"}`, ...notes],
    };
  }

  const result = await installPkg({
    pkgPath,
    elevate: effectiveElevate(ctx),
    interactive: isInteractive(),
  });
  notes.push(
    result.method === "osascript"
      ? "instalado com autorização de administrador (diálogo do sistema)"
      : result.method === "sudo"
        ? "instalado via sudo no terminal"
        : "instalado como root",
  );

  const receipts = await readReceipts(componentIds);
  const observedApps = await observedAppsFromPayload(pkg);
  const receiptWithVersion = receipts.find((receipt) => receipt.installed && receipt.version !== null) ?? null;
  const installedVersion = receiptWithVersion?.version ?? declaredVersion;
  const versionEvidence: VersionEvidence =
    receiptWithVersion?.version != null ? "pkg-receipt" : declaredVersion !== null ? "distribution-xml" : "unknown";
  const missingReceipts = receipts.filter((receipt) => !receipt.installed);
  if (missingReceipts.length > 0) {
    warnings.push(`sem receipt para: ${missingReceipts.map((receipt) => receipt.identifier).join(", ")}`);
  }
  if (installedVersion === null) {
    notes.push("a versão instalada não pôde ser determinada (item registrado como versão desconhecida)");
  }

  const installedPath = observedApps[0]?.path ?? null;
  const draft: ItemDraft = {
    kind: "pkg",
    artifactType: "pkg",
    baseId: pkg.components[0]?.identifier ?? `pkg:${slugify(displayName)}`,
    displayName,
    aliases: [pkg.title ?? ""],
    bundleId: primaryApp?.bundleId ?? null,
    installedPath,
    installedVersion,
    buildVersion: null,
    versionEvidence,
    arch: null,
    weakIdentity: componentIds.length === 0,
    source: params.source,
    artifact: {
      sha256: params.sha256,
      size: params.sizeBytes,
      releaseTag: params.releaseTag,
      fileName: params.fileName,
    },
    receipts,
    observedApps,
    verification: {
      integrityOk: pkg.signature.signed ? true : null,
      signed: pkg.signature.signed,
      notarized: pkg.signature.notarized,
      teamId: pkg.signature.teamId,
      overrides,
    },
    lastResult: existing !== null ? "updated" : "installed",
  };

  const item = await persistItem(draft, existing, false);
  ui.info(
    `${existing !== null ? "atualizado" : "instalado"}: ${item.displayName} ${item.installedVersion ?? "(versão desconhecida)"}${item.installedPath !== null ? ` em ${item.installedPath}` : ""}`,
  );
  return {
    action: existing !== null ? "updated" : "installed",
    item,
    installedPath: item.installedPath,
    installedVersion: item.installedVersion,
    previousVersion: item.previousVersion,
    warnings,
    notes,
  };
}

// ---------------------------------------------------------------------------
// comuns
// ---------------------------------------------------------------------------

async function chooseCandidate(params: ApplyParams, candidates: DmgCandidate[]): Promise<DmgCandidate> {
  const first = candidates[0];
  if (candidates.length === 1 && first !== undefined) return first;

  const hint = params.assetName ?? params.fileName;
  const normalizedHint = normalizeName(basename(hint, extname(hint)));
  if (normalizedHint.length > 0) {
    const exact = candidates.filter((candidate) => normalizeName(basename(candidate.path, extname(candidate.path))) === normalizedHint);
    const only = exact[0];
    if (exact.length === 1 && only !== undefined) {
      ui.verbose(`candidato escolhido pelo nome do arquivo: ${only.relative}`);
      return only;
    }
  }

  if (canPrompt(params.ctx)) {
    const choice = await chooseOne(
      "A imagem contém mais de um item instalável.",
      candidates.map((candidate, index) => ({
        value: String(index),
        label: candidate.relative,
        description: candidate.kind,
      })),
    );
    const chosen = candidates[Number.parseInt(choice, 10)];
    if (chosen !== undefined) return chosen;
  }
  throw new AmbiguityError("a imagem contém vários itens instaláveis", {
    hint: "rode interativamente para escolher (sem --yes)",
    details: { candidates: candidates.map((candidate) => candidate.relative) },
  });
}

async function findExistingByIdentity(identity: ArtifactIdentity): Promise<RegistryItem | null> {
  const registry = await loadRegistry();
  const matches = findItemsByIdentity(registry.items, identity);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new AmbiguityError("mais de um item registrado corresponde a este arquivo", {
      hint: "use --app <id> para escolher qual atualizar",
      details: { candidates: matches.map((item) => item.id) },
    });
  }
  return matches[0] ?? null;
}

async function resolveAppDestination(ctx: Ctx, existing: RegistryItem | null): Promise<string> {
  if (existing?.installedPath != null && ctx.opts.destination === undefined) {
    const dir = dirname(existing.installedPath);
    if (await pathExists(dir)) return dir;
  }
  return await resolveDestinationDirFor(ctx.config, ctx.opts.destination);
}

async function checkIdentityAndArchChanges(
  risk: RiskContext,
  existing: RegistryItem | null,
  app: AppBundleInfo,
  displayName: string,
): Promise<void> {
  if (existing === null) return;
  if (existing.bundleId !== null && app.bundleId !== null && existing.bundleId !== app.bundleId) {
    const message = `${displayName} mudou de identidade (${existing.bundleId} → ${app.bundleId})`;
    risk.warnings.push(message);
    await requireOrNote(risk, message, "identity-change");
  }
  const previousArchs = archsOf(existing);
  if (previousArchs !== null && app.archs !== null && !sameArchs(previousArchs, app.archs)) {
    const message = `${displayName} mudou de arquitetura (${previousArchs.join(" ")} → ${app.archs.join(" ")})`;
    risk.warnings.push(message);
    await requireOrNote(risk, message, "arch-change");
  }
}

/**
 * Validação de arquitetura com as fatias reais do bundle (lipo), antes de instalar:
 * arm64 em Intel bloqueia; x64 em Apple Silicon exige Rosetta 2 + aceite.
 */
async function checkBundleArchitecture(
  risk: RiskContext,
  app: AppBundleInfo,
  displayName: string,
  acceptedMismatch: boolean,
): Promise<void> {
  const machine = machineArch();
  const compatibility = archsCompatibility(app.archs, machine);
  if (compatibility === "impossible") {
    throw new InstallError(
      `${displayName} contém apenas ${describeAssetArch(classifyArchList(app.archs))} e esta máquina é ${humanArch(machine)}`,
      { hint: "escolha um build nativo ou universal", details: { archs: app.archs, machine } },
    );
  }
  if (compatibility === "needs-rosetta") {
    const rosetta = await rosettaAvailable();
    if (!rosetta) {
      throw new InstallError(
        `${displayName} não tem build nativo para ${humanArch(machine)} e o Rosetta 2 não está disponível`,
        { hint: "instale com `softwareupdate --install-rosetta` ou escolha um build nativo" },
      );
    }
    const message = `${displayName} não tem build nativo para ${humanArch(machine)} (${describeAssetArch(classifyArchList(app.archs))}); depende do Rosetta 2`;
    if (acceptedMismatch) {
      if (!risk.overrides.includes("arch-mismatch")) risk.overrides.push("arch-mismatch");
      ui.warn(`${message} — já aceito antes do download`);
      return;
    }
    await requireArchAcceptance(risk, message);
    return;
  }
  if (compatibility === "unknown") {
    risk.notes.push("arquitetura do bundle não pôde ser determinada (sem binário Mach-O legível); o macOS decidirá na execução");
  }
}

function computeTagComparable(
  releaseTag: string | null,
  appVersion: string | null,
  warnings: string[],
): { tag: string; appVersion: string; observedAt: string } | null {
  if (releaseTag === null || appVersion === null) return null;
  if (tagMapsToVersion(releaseTag, appVersion)) {
    return { tag: releaseTag, appVersion, observedAt: new Date().toISOString() };
  }
  if (normalizeTag(releaseTag) === null) {
    warnings.push(`a tag ${releaseTag} não parece uma versão; comparações por tag ficarão como "unknown"`);
  } else {
    warnings.push(
      `a tag ${releaseTag} não corresponde à versão do app (${appVersion}); comparações futuras por tag ficarão como "unknown"`,
    );
  }
  return null;
}

function verificationFrom(assessment: SignatureAssessment | null, overrides: string[]): VerificationInfo {
  if (assessment === null) {
    return { integrityOk: null, signed: null, notarized: null, teamId: null, overrides };
  }
  return {
    integrityOk: assessment.integrityOk,
    signed: assessment.signed,
    notarized: assessment.notarized,
    teamId: assessment.teamId,
    overrides,
  };
}

async function persistItem(draft: ItemDraft, existing: RegistryItem | null, keepBoth: boolean): Promise<RegistryItem> {
  return await updateRegistry((registry) => {
    const id = keepBoth || existing === null ? uniqueItemId(registry, draft.baseId) : existing.id;
    const item = buildRegistryItem(draft, existing, id);
    upsertItem(registry, item);
    return item;
  });
}

async function tryReadBundle(path: string): Promise<AppBundleInfo | null> {
  try {
    return await readAppBundle(path);
  } catch {
    return null;
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}


