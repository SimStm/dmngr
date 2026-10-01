import { Command, CommanderError, Option } from "commander";
import { installSignalHandlers } from "../core/cleanup.ts";
import { EXIT_CODES, UsageError, errorPayload, toDmngrError } from "../core/errors.ts";
import { configureUi, ui } from "../core/output.ts";
import {
  createCtx,
  defaultOperationOptions,
  type GlobalOptions,
  type OperationOptions,
} from "../core/ops/context.ts";
import { runCheck } from "../core/ops/check.ts";
import { runDoctor, summarizeDoctor } from "../core/ops/doctor.ts";
import { renderReport, reportToJson, runInstall } from "../core/ops/install.ts";
import { readLiveItemInfo } from "../core/ops/live.ts";
import { runUpdate } from "../core/ops/update.ts";
import { resolveItem, suggestItems } from "../core/registry/resolve.ts";
import { loadRegistry } from "../core/registry/store.ts";
import type { RegistryItem } from "../core/registry/schema.ts";
import { VERSION } from "../version.ts";
import {
  buildListRows,
  checkRowJson,
  infoJson,
  listRowJson,
  renderCheckTable,
  renderDoctor,
  renderInfo,
  renderListTable,
  renderUpdateAll,
} from "./render.ts";

let jsonMode = false;

export async function runCli(argv: string[]): Promise<void> {
  installSignalHandlers();
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (error) {
    process.exitCode = handleCliError(error);
  }
}

function handleCliError(error: unknown): number {
  if (error instanceof CommanderError) {
    if (error.code === "commander.helpDisplayed" || error.code === "commander.help" || error.code === "commander.version") {
      return EXIT_CODES.ok;
    }
    const usageError = new UsageError(error.message.replace(/^error: /, ""));
    printError(usageError);
    return EXIT_CODES.usage;
  }
  const dmngrError = toDmngrError(error);
  printError(dmngrError);
  return dmngrError.exitCode;
}

function printError(error: Error & { message: string; hint?: string }): void {
  if (jsonMode) {
    process.stderr.write(`${JSON.stringify(errorPayload(error), null, 2)}\n`);
    return;
  }
  ui.error(error.message);
  if (typeof error.hint === "string") process.stderr.write(`dica: ${error.hint}\n`);
}

function addCommonFlags(command: Command): Command {
  return command
    .option("--json", "saída JSON no stdout (nunca pergunta)")
    .option("--verbose", "detalhes extras no stderr")
    .option("--quiet", "silencia mensagens de progresso")
    .option("--yes", "responde sim apenas a decisões não ambíguas");
}

function operationOptions(program: Command, command: Command, extra: Partial<OperationOptions> = {}): OperationOptions {
  const global = program.opts<GlobalOptions>();
  const local = command.opts<GlobalOptions>();
  const pick = <T>(first: T | undefined, second: T | undefined, fallback: T): T => first ?? second ?? fallback;
  const base = defaultOperationOptions({
    json: pick(local.json, global.json, false),
    verbose: pick(local.verbose, global.verbose, false),
    quiet: pick(local.quiet, global.quiet, false),
    yes: pick(local.yes, global.yes, false),
  });
  return { ...base, ...extra };
}

function applyUi(options: OperationOptions): void {
  configureUi({ json: options.json, verbose: options.verbose, quiet: options.quiet });
  jsonMode = options.json;
}

function findItemOrFail(items: RegistryItem[], query: string): RegistryItem {
  const item = resolveItem(items, query);
  if (item === null) {
    const suggestions = suggestItems(items, query);
    throw new UsageError(`item não encontrado: ${query}`, {
      hint: suggestions.length > 0 ? `talvez você quis dizer: ${suggestions.join(", ")}` : "veja `dmngr list`",
    });
  }
  return item;
}

function validateSha256(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new UsageError("--sha256 espera 64 caracteres hexadecimais");
  }
  return normalized;
}

function buildProgram(): Command {
  const program = new Command();
  // precisa ser definido antes de criar os subcomandos (eles herdam o callback)
  program.exitOverride();
  program
    .name("dmngr")
    .description("Instala e atualiza apps do macOS a partir de DMG/PKG (URL ou arquivo) sem abrir o Finder")
    .version(VERSION, "-v, --version", "mostra a versão e sai");
  addCommonFlags(program);
  program.configureOutput({ writeErr: (text) => process.stderr.write(text) });
  program.showHelpAfterError("(use --help para ver as opções)");

  addCommonFlags(
    program.command("list").description("lista os itens gerenciados (não usa a rede)"),
  ).action(async (_options: unknown, command: Command) => {
    const options = operationOptions(program, command);
    applyUi(options);
    const registry = await loadRegistry();
    const rows = await buildListRows(registry.items);
    ui.data({ schemaVersion: 1, items: rows.map(listRowJson) }, () => {
      process.stdout.write(`${renderListTable(rows)}\n`);
    });
  });

  addCommonFlags(
    program
      .command("info")
      .description("mostra detalhes de um item, relendo a versão instalada no disco")
      .argument("<item>", "id, nome ou alias do item"),
  ).action(async (query: string, _options: unknown, command: Command) => {
    const options = operationOptions(program, command);
    applyUi(options);
    const registry = await loadRegistry();
    const item = findItemOrFail(registry.items, query);
    const live = await readLiveItemInfo(item);
    ui.data(infoJson(item, live), () => renderInfo(item, live));
  });

  addCommonFlags(
    program
      .command("check")
      .description("consulta versões disponíveis sem instalar (usa a rede)")
      .argument("[item]", "verifica apenas um item"),
  )
    .option("--prerelease", "consulta o canal de pré-lançamentos em vez do canal registrado no item")
    .action(async (query: string | undefined, _options: unknown, command: Command) => {
    const options = operationOptions(program, command, { prerelease: Boolean(command.opts().prerelease) });
    applyUi(options);
    const ctx = await createCtx(options);
    const { rows, refreshed } = await runCheck(ctx, query);
    ui.data({ schemaVersion: 1, refreshed, items: rows.map(checkRowJson) }, () => renderCheckTable(rows));
  });

  addCommonFlags(
    program
      .command("install")
      .description("instala (ou atualiza) um app a partir de URL HTTPS ou arquivo local")
      .argument("<url-ou-arquivo>", "URL https:// ou caminho de um .dmg/.pkg"),
  )
    .option("--dry-run", "mostra o plano sem baixar nem alterar nada")
    .option("--reinstall", "instala mesmo quando a versão e o hash são idênticos")
    .option("--destination <dir>", "destino do bundle .app (padrão: /Applications)")
    .option("--sha256 <hash>", "exige que o arquivo tenha este SHA-256")
    .option("--keep-download", "mantém o arquivo baixado em vez de apagar")
    .option(
      "--allow-unverified",
      "aceita app não notarizado, troca de identidade/arquitetura, arquitetura sem build nativo e PKG com scripts (fica registrado no item)",
    )
    .option("--prerelease", "usa a release publicada mais recente, incluindo pré-lançamentos (canal prerelease)")
    .option("--pin", "usa exatamente a versão fixada na URL, sem perguntar (exige …/releases/download/<tag>/…)")
    .option("--latest", "usa a última release do canal, mesmo quando a URL fixa outra versão")
    .option("--allow-arch-mismatch", "aceita app sem build nativo para esta máquina (Rosetta 2 em Apple Silicon)")
    .option("--allow-http", "permite links http:// (inseguros)")
    .option("--allow-private-network", "permite hosts internos/privados (SSRF)")
    .addOption(new Option("--elevate <modo>", "elevação para instalar PKG").choices(["osascript", "sudo", "none"]))
    .action(async (input: string, _options: unknown, command: Command) => {
      const options = operationOptions(program, command, {
        dryRun: Boolean(command.opts().dryRun),
        reinstall: Boolean(command.opts().reinstall),
        destination: command.opts().destination,
        sha256: validateSha256(command.opts().sha256),
        keepDownload: Boolean(command.opts().keepDownload),
        allowUnverified: Boolean(command.opts().allowUnverified),
        prerelease: Boolean(command.opts().prerelease),
        pin: Boolean(command.opts().pin),
        latest: Boolean(command.opts().latest),
        allowArchMismatch: Boolean(command.opts().allowArchMismatch),
        allowHttp: Boolean(command.opts().allowHttp),
        allowPrivateNetwork: Boolean(command.opts().allowPrivateNetwork),
        elevate: command.opts().elevate,
      });
      applyUi(options);
      const ctx = await createCtx(options);
      const report = await runInstall(ctx, input);
      ui.data(reportToJson(report), () => renderReport(report));
    });

  addCommonFlags(
    program
      .command("update")
      .description("atualiza um item já registrado (ou associa um artefato por identidade)")
      .argument("[item-ou-url]", "item registrado, URL ou arquivo"),
  )
    .option("--url <url>", "usa uma URL nova para atualizar o item")
    .option("--all", "atualiza todos os itens com atualização confirmável")
    .option("--app <id>", "item de destino quando o argumento é uma URL/arquivo")
    .option("--dry-run", "mostra o plano sem baixar nem alterar nada")
    .option("--reinstall", "instala mesmo quando a versão e o hash são idênticos")
    .option("--destination <dir>", "destino do bundle .app")
    .option("--sha256 <hash>", "exige que o arquivo tenha este SHA-256")
    .option("--keep-download", "mantém o arquivo baixado em vez de apagar")
    .option(
      "--allow-unverified",
      "aceita app não notarizado, troca de identidade/arquitetura, arquitetura sem build nativo e PKG com scripts (fica registrado no item)",
    )
    .option("--prerelease", "usa/seguir o canal de pré-lançamentos (release publicada mais recente)")
    .option("--pin", "mantém a versão fixada pela URL informada (exige …/releases/download/<tag>/…)")
    .option("--latest", "segue o canal e remove uma fixação anterior")
    .option("--allow-arch-mismatch", "aceita app sem build nativo para esta máquina (Rosetta 2 em Apple Silicon)")
    .option("--allow-http", "permite links http:// (inseguros)")
    .option("--allow-private-network", "permite hosts internos/privados (SSRF)")
    .addOption(new Option("--elevate <modo>", "elevação para instalar PKG").choices(["osascript", "sudo", "none"]))
    .action(async (target: string | undefined, _options: unknown, command: Command) => {
      const options = operationOptions(program, command, {
        dryRun: Boolean(command.opts().dryRun),
        reinstall: Boolean(command.opts().reinstall),
        destination: command.opts().destination,
        sha256: validateSha256(command.opts().sha256),
        keepDownload: Boolean(command.opts().keepDownload),
        allowUnverified: Boolean(command.opts().allowUnverified),
        prerelease: Boolean(command.opts().prerelease),
        pin: Boolean(command.opts().pin),
        latest: Boolean(command.opts().latest),
        allowArchMismatch: Boolean(command.opts().allowArchMismatch),
        allowHttp: Boolean(command.opts().allowHttp),
        allowPrivateNetwork: Boolean(command.opts().allowPrivateNetwork),
        elevate: command.opts().elevate,
        app: command.opts().app,
      });
      applyUi(options);
      const ctx = await createCtx(options);
      const outcome = await runUpdate(ctx, target, {
        url: command.opts().url,
        all: Boolean(command.opts().all),
        app: command.opts().app,
      });
      if (outcome.kind === "all") {
        ui.data(
          { schemaVersion: 1, command: "update-all", ...outcome.report },
          () => renderUpdateAll(outcome.report.rows),
        );
        return;
      }
      ui.data(reportToJson(outcome.report), () => renderReport(outcome.report));
    });

  addCommonFlags(
    program.command("doctor").description("diagnostica registro, itens, montagens pendentes e ferramentas"),
  ).action(async (_options: unknown, command: Command) => {
    const options = operationOptions(program, command);
    applyUi(options);
    const issues = await runDoctor();
    ui.data({ schemaVersion: 1, summary: summarizeDoctor(issues), issues }, () => renderDoctor(issues));
  });

  return program;
}
