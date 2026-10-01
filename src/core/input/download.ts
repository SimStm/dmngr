import { open } from "node:fs/promises";
import { DmngrError, NetworkError, SecurityError, errorMessage, toDmngrError } from "../errors.ts";
import { removePath, sleep } from "../fsx.ts";
import { ui } from "../output.ts";
import { VERSION } from "../../version.ts";
import { assertUrlAllowed, redactUrl, type NetworkPolicy } from "./resolve.ts";

export const USER_AGENT = `dmngr/${VERSION} (macOS CLI)`;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_REDIRECTS = 10;

export interface DownloadRequest {
  url: string;
  destinationPath: string;
  policy: NetworkPolicy;
  headers?: Record<string, string>;
  maxBytes: number;
  expectedSha256?: string | null;
  expectedSize?: number | null;
  retries?: number;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  onProgress?: (received: number, total: number | null) => void;
}

export interface DownloadResult {
  path: string;
  finalUrl: string;
  sha256: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  redirects: string[];
}

export async function downloadToFile(request: DownloadRequest): Promise<DownloadResult> {
  const retries = request.retries ?? 2;
  let lastError: DmngrError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await attemptDownload(request);
    } catch (error) {
      const dmngrError = toDmngrError(error);
      lastError = dmngrError;
      await removePath(request.destinationPath).catch(() => {
        /* melhor esforço */
      });
      if (!isRetryable(dmngrError) || attempt === retries) throw dmngrError;
      const delay = retryDelayMs(dmngrError, attempt);
      ui.warn(`nova tentativa em ${Math.round(delay / 1000)}s (${errorMessage(dmngrError)})`);
      await sleep(delay);
    }
  }
  throw lastError ?? new NetworkError("falha no download");
}

function isRetryable(error: DmngrError): boolean {
  if (error.kind !== "network") return false;
  const status = (error.details as { status?: number } | undefined)?.status;
  if (status === undefined) return true; // erro de transporte
  return RETRYABLE_STATUSES.has(status);
}

function retryDelayMs(error: DmngrError, attempt: number): number {
  const retryAfter = (error.details as { retryAfterMs?: number } | undefined)?.retryAfterMs;
  if (typeof retryAfter === "number" && retryAfter > 0) return Math.min(retryAfter, 60_000);
  return Math.min(1000 * 2 ** attempt, 15_000);
}

async function attemptDownload(request: DownloadRequest): Promise<DownloadResult> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, ...request.headers };
  let current = request.url;
  const redirects: string[] = [];

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertUrlAllowed(current, request.policy);
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers,
      timeoutMs: request.connectTimeoutMs ?? 30_000,
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location === null) {
        throw new NetworkError(`redirect ${response.status} sem cabeçalho Location`, {
          details: { status: response.status, url: redactUrl(url.toString()) },
        });
      }
      await response.body?.cancel().catch(() => {
        /* melhor esforço */
      });
      const next = new URL(location, url);
      redirects.push(redactUrl(next.toString()));
      current = next.toString();
      continue;
    }

    if (response.status >= 400) throw statusError(response, url.toString());

    const total = contentLength(response);
    const handle = await open(request.destinationPath, "wx", 0o600);
    const hasher = new Bun.CryptoHasher("sha256");
    let received = 0;
    const reader = response.body?.getReader();
    if (reader === undefined) {
      await handle.close();
      throw new NetworkError("resposta sem corpo", { details: { status: response.status } });
    }
    try {
      for (;;) {
        const chunk = await readChunk(reader, request.idleTimeoutMs ?? 60_000, redactUrl(url.toString()));
        if (chunk.done) break;
        const value = chunk.value;
        if (value === undefined) continue;
        received += value.byteLength;
        if (received > request.maxBytes) {
          throw new NetworkError(`download excedeu o limite de ${formatBytes(request.maxBytes)}`, {
            hint: "ajuste maxDownloadBytes no config.json",
            details: { limit: request.maxBytes, received },
          });
        }
        hasher.update(value);
        await handle.write(value);
        request.onProgress?.(received, total);
      }
      await handle.sync();
    } finally {
      await handle.close().catch(() => {
        /* melhor esforço */
      });
    }

    const sha256 = hasher.digest("hex");
    if (request.expectedSha256 != null && request.expectedSha256.toLowerCase() !== sha256) {
      throw new SecurityError("o hash SHA-256 do arquivo não confere", {
        hint: "o download pode ter sido corrompido ou adulterado; nada foi instalado",
        details: { expected: request.expectedSha256.toLowerCase(), actual: sha256 },
      });
    }
    if (request.expectedSize != null && request.expectedSize !== received) {
      throw new SecurityError("o tamanho do arquivo difere do esperado", {
        hint: "o artefato mudou no servidor; nada foi instalado",
        details: { expected: request.expectedSize, actual: received },
      });
    }

    return {
      path: request.destinationPath,
      finalUrl: url.toString(),
      sha256,
      size: received,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentType: response.headers.get("content-type"),
      redirects,
    };
  }

  throw new NetworkError("excesso de redirects", { details: { redirects } });
}

export interface UrlMetadata {
  status: number;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  contentLength: number | null;
  redirects: string[];
  method: "HEAD" | "GET";
}

export interface ProbeRequest {
  url: string;
  policy: NetworkPolicy;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Consulta metadados sem baixar o conteúdo.
 * ETag/Last-Modified/Tamanho apenas sugerem mudança — nunca são tratados como versão.
 */
export async function probeUrl(request: ProbeRequest): Promise<UrlMetadata> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, ...request.headers };
  const head = await attemptProbe(request, headers, "HEAD");
  if (head.status === 405 || head.status === 501 || head.status === 403 || head.status === 400) {
    const ranged = await attemptProbe({ ...request, headers: { ...headers, range: "bytes=0-0" } }, headers, "GET");
    if (ranged.status >= 200 && ranged.status < 300) return ranged;
    return head;
  }
  return head;
}

async function attemptProbe(
  request: ProbeRequest,
  headers: Record<string, string>,
  method: "HEAD" | "GET",
): Promise<UrlMetadata> {
  let current = request.url;
  const redirects: string[] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = await assertUrlAllowed(current, request.policy);
    const response = await fetchWithTimeout(url, { method, headers, timeoutMs: request.timeoutMs ?? 20_000 });
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (location === null) {
        throw new NetworkError(`redirect ${response.status} sem cabeçalho Location`, {
          details: { status: response.status, url: redactUrl(url.toString()) },
        });
      }
      await response.body?.cancel().catch(() => {
        /* melhor esforço */
      });
      const next = new URL(location, url);
      redirects.push(redactUrl(next.toString()));
      current = next.toString();
      continue;
    }
    if (response.status >= 500) throw statusError(response, url.toString());
    await response.body?.cancel().catch(() => {
      /* melhor esforço */
    });
    return {
      status: response.status,
      finalUrl: url.toString(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
      contentLength: contentLength(response),
      redirects,
      method,
    };
  }
  throw new NetworkError("excesso de redirects", { details: { redirects } });
}

async function fetchWithTimeout(url: URL, options: { method: string; headers: Record<string, string>; timeoutMs: number }): Promise<Response> {
  try {
    return await fetch(url, {
      method: options.method,
      headers: options.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    throw new NetworkError(`falha de rede ao acessar ${redactUrl(url.toString())}`, {
      details: { cause: errorMessage(error) },
      cause: error,
    });
  }
}

function statusError(response: Response, url: string): NetworkError {
  const status = response.status;
  const retryAfterHeader = response.headers.get("retry-after");
  const details: Record<string, unknown> = { status, url: redactUrl(url) };
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (retryAfterMs !== null) details.retryAfterMs = retryAfterMs;

  if (status === 404) {
    return new NetworkError("arquivo não encontrado no servidor (HTTP 404)", { details });
  }
  if (status === 401 || status === 403) {
    return new NetworkError(`acesso negado (HTTP ${status})`, {
      hint: "para repositórios privados do GitHub, defina GITHUB_TOKEN",
      details,
    });
  }
  if (status === 429) {
    return new NetworkError("limite de requisições atingido (HTTP 429)", {
      hint: "aguarde e tente de novo; GITHUB_TOKEN aumenta o limite do GitHub",
      details,
    });
  }
  return new NetworkError(`resposta HTTP ${status}`, { details });
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

export interface ChunkReadResult {
  done: boolean;
  value?: Uint8Array;
}

interface ChunkReader {
  read(): Promise<ChunkReadResult>;
  cancel?(reason?: unknown): Promise<void>;
}

async function readChunk(reader: ChunkReader, idleMs: number, url: string): Promise<ChunkReadResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel?.().catch(() => {
            /* melhor esforço */
          });
          reject(
            new NetworkError(`o download ficou ${Math.round(idleMs / 1000)}s sem receber dados de ${url}`, {
              details: { idleMs },
            }),
          );
        }, idleMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function contentLength(response: Response): number | null {
  const header = response.headers.get("content-length");
  if (header === null) return null;
  const value = Number.parseInt(header, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index] ?? "KiB"}`;
}
