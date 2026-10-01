import { loadConfig, type ElevateMode } from "../config.ts";
import type { NetworkPolicy } from "../input/resolve.ts";
import { isInteractive } from "../prompts.ts";
import { GithubClient } from "../providers/github.ts";
import type { Config } from "../config.ts";

export interface GlobalOptions {
  json: boolean;
  verbose: boolean;
  quiet: boolean;
  yes: boolean;
}

export interface OperationOptions extends GlobalOptions {
  dryRun: boolean;
  reinstall: boolean;
  allowUnverified: boolean;
  destination: string | undefined;
  sha256: string | undefined;
  keepDownload: boolean;
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
  app: string | undefined;
  elevate: ElevateMode | undefined;
  /** Usa o canal de pré-lançamentos (release publicada mais recente). */
  prerelease: boolean;
  /** Usa exatamente a tag/asset fixados pela URL, sem perguntar. */
  pin: boolean;
  /** Usa a cabeça do canal, mesmo quando a URL fixa outra versão. */
  latest: boolean;
  /** Aceita app sem build nativo para esta máquina (Rosetta 2). */
  allowArchMismatch: boolean;
}

export function defaultOperationOptions(global: Partial<GlobalOptions> = {}): OperationOptions {
  return {
    json: global.json ?? false,
    verbose: global.verbose ?? false,
    quiet: global.quiet ?? false,
    yes: global.yes ?? false,
    dryRun: false,
    reinstall: false,
    allowUnverified: false,
    destination: undefined,
    sha256: undefined,
    keepDownload: false,
    allowHttp: false,
    allowPrivateNetwork: false,
    app: undefined,
    elevate: undefined,
    prerelease: false,
    pin: false,
    latest: false,
    allowArchMismatch: false,
  };
}

export interface Ctx {
  config: Config;
  opts: OperationOptions;
  github: GithubClient;
}

export async function createCtx(opts: OperationOptions): Promise<Ctx> {
  const config = await loadConfig();
  return { config, opts, github: GithubClient.fromEnv() };
}

export function networkPolicy(ctx: Ctx): NetworkPolicy {
  return {
    allowHttp: ctx.opts.allowHttp || ctx.config.allowHttp,
    allowPrivateNetwork: ctx.opts.allowPrivateNetwork || ctx.config.allowPrivateNetwork,
  };
}

/** Só pergunta quando há terminal, o usuário não pediu modo automático e a saída não é JSON. */
export function canPrompt(ctx: Ctx): boolean {
  return isInteractive() && !ctx.opts.yes && !ctx.opts.json;
}

export function effectiveElevate(ctx: Ctx): ElevateMode {
  return ctx.opts.elevate ?? ctx.config.elevate;
}

export function maxDownloadBytes(ctx: Ctx): number {
  return ctx.config.maxDownloadBytes;
}

export function keepDownloads(ctx: Ctx): boolean {
  return ctx.opts.keepDownload || ctx.config.keepDownloads;
}

export function githubRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token !== undefined && token.length > 0) headers.authorization = `Bearer ${token}`;
  return headers;
}
