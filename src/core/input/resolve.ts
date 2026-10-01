import { lookup } from "node:dns/promises";
import { isAbsolute, resolve } from "node:path";
import { NetworkError, SecurityError, UsageError } from "../errors.ts";
import { expandHome, pathExists, resolveRealPath } from "../fsx.ts";

export type InputKind = "url" | "file";

export type GithubOrigin = "repo" | "releases" | "latest" | "tag" | "asset" | "api";

export interface GithubRef {
  owner: string;
  repo: string;
  /** Tag fixada pela URL; null = cabeça do canal (stable/prerelease). */
  tag: string | null;
  /** Asset fixado pela URL; null = escolher a partir da release. */
  asset: string | null;
  origin: GithubOrigin;
}

export interface ParsedInput {
  kind: InputKind;
  raw: string;
  displayUrl: string;
  url: string | null;
  filePath: string | null;
  github: GithubRef | null;
}

export interface NetworkPolicy {
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
}

const SENSITIVE_QUERY_KEY =
  /^(token|access[_-]?token|api[_-]?key|apikey|key|sig|signature|auth|authorization|secret|password|passwd|pwd|credential|credentials|expires|expire|policy|x-amz-.+|x-goog-.+|session|sessionid|sessiontoken)$/i;

const REDACTED = "REDACTED";

export function redactUrl(input: string): string {
  try {
    const url = new URL(input);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    return input;
  }
}

/** URLs com credenciais ou tokens na query não são rastreáveis com segurança. */
export function hasSensitiveQuery(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.username.length > 0 || url.password.length > 0) return true;
    return [...url.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key));
  } catch {
    return false;
  }
}

export async function classifyInput(raw: string): Promise<ParsedInput> {
  const value = raw.trim();
  if (value.length === 0) throw new UsageError("entrada vazia");

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new UsageError(`URL inválida: ${value}`);
    }
    if (url.protocol === "file:") {
      throw new UsageError("use o caminho do arquivo em vez de file://", { hint: decodeURIComponent(url.pathname) });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new UsageError(`protocolo não suportado: ${url.protocol}`, { hint: "use https:// ou um caminho local" });
    }
    return {
      kind: "url",
      raw: value,
      displayUrl: redactUrl(value),
      url: url.toString(),
      filePath: null,
      github: parseGithubUrl(url),
    };
  }

  const expanded = expandHome(value);
  const absolute = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
  if (!(await pathExists(absolute))) {
    throw new UsageError(`arquivo ou diretório não encontrado: ${absolute}`);
  }
  const real = await resolveRealPath(absolute);
  return {
    kind: "file",
    raw: value,
    displayUrl: real,
    url: null,
    filePath: real,
    github: null,
  };
}

/**
 * Seções do github.com que existem mas nunca apontam para um arquivo instalável.
 * Servem para dar uma mensagem útil em vez de tentar baixar uma página HTML.
 */
const NON_INSTALLABLE_SECTIONS = new Set([
  "tree",
  "blob",
  "issues",
  "pull",
  "pulls",
  "actions",
  "wiki",
  "commit",
  "commits",
  "discussions",
  "projects",
  "settings",
  "security",
  "compare",
  "branches",
  "tags",
  "milestones",
  "labels",
  "packages",
  "codespaces",
  "sponsors",
  "stargazers",
  "watchers",
  "forks",
  "network",
  "pulse",
  "graphs",
  "edit",
]);

/** Primeiro segmento do path que é uma página do próprio GitHub (não um usuário/org). */
const RESERVED_FIRST_SEGMENTS = new Set([
  "settings",
  "marketplace",
  "explore",
  "topics",
  "collections",
  "sponsors",
  "features",
  "about",
  "pricing",
  "enterprise",
  "apps",
  "login",
  "join",
  "signup",
  "site",
  "contact",
  "security",
  "notifications",
  "codespaces",
  "new",
  "import",
  "organizations",
  "users",
  "search",
  "events",
  "trending",
  "dashboard",
  "account",
  "sessions",
  "logout",
]);

/**
 * Reconhece links do GitHub que apontam para releases: repositório, página de
 * releases, página de tag, `releases/latest`, URLs de download e equivalentes da API.
 * Arquivos de código-fonte e páginas que nunca apontam para um instalável são recusados.
 */
export function parseGithubUrl(url: URL): GithubRef | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0).map(decodeURIComponent);

  if (host === "github.com" || host === "www.github.com") {
    const [owner, repo, section, ...rest] = segments;
    if (!owner || !repo) return null;
    if (!section) return RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase()) ? null : { owner, repo, tag: null, asset: null, origin: "repo" };

    if (section === "archive") {
      throw new UsageError("arquivos de código-fonte do GitHub não são instaláveis", {
        hint: `use o asset publicado na release (.dmg/.pkg) em https://github.com/${owner}/${repo}/releases`,
      });
    }

    if (section !== "releases") {
      if (RESERVED_FIRST_SEGMENTS.has(owner.toLowerCase())) return null;
      if (NON_INSTALLABLE_SECTIONS.has(section)) {
        throw new UsageError(`esse link do GitHub (/${section}/…) não aponta para um arquivo instalável`, {
          hint: `use a página do repositório (https://github.com/${owner}/${repo}) ou a URL do asset (.dmg/.pkg)`,
        });
      }
      return null;
    }

    const mode = rest[0];
    if (mode === undefined) return { owner, repo, tag: null, asset: null, origin: "releases" };

    if (mode === "latest") {
      if (rest[1] === "download") {
        const asset = rest.slice(2).join("/");
        if (asset.length === 0) return null;
        return { owner, repo, tag: null, asset, origin: "asset" };
      }
      return { owner, repo, tag: null, asset: null, origin: "latest" };
    }

    if (mode === "download") {
      const tag = rest[1] ?? null;
      const asset = rest.slice(2).join("/");
      if (tag === null || asset.length === 0) return null;
      return { owner, repo, tag, asset, origin: "asset" };
    }

    if (mode === "tag") {
      const tag = rest[1] ?? null;
      if (tag === null) return null;
      return { owner, repo, tag, asset: null, origin: "tag" };
    }

    throw new UsageError(`essa página de releases do GitHub não é suportada (/releases/${mode}/…)`, {
      hint: `use https://github.com/${owner}/${repo}/releases ou a URL do asset`,
    });
  }

  if (host === "api.github.com") {
    const [repos, owner, repo, releases, mode, ...rest] = segments;
    if (repos !== "repos" || !owner || !repo || releases !== "releases") return null;
    if (mode === undefined || mode === "latest") return { owner, repo, tag: null, asset: null, origin: "api" };
    if (mode === "tags") {
      const tag = rest[0];
      if (!tag) throw new UsageError("URL da API sem a tag", { hint: "use /repos/{owner}/{repo}/releases/tags/{tag}" });
      return { owner, repo, tag, asset: null, origin: "api" };
    }
    throw new UsageError(`essa URL da API do GitHub não é suportada (/releases/${mode}/…)`, {
      hint: `use https://api.github.com/repos/${owner}/${repo}/releases ou a página do repositório`,
    });
  }

  return null;
}

export async function assertUrlAllowed(rawUrl: string, policy: NetworkPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UsageError(`URL inválida: ${rawUrl}`);
  }

  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:") {
    if (!policy.allowHttp) {
      throw new SecurityError(`HTTP não é permitido: ${redactUrl(rawUrl)}`, {
        hint: "use https:// ou passe --allow-http conscientemente",
      });
    }
  } else {
    throw new SecurityError(`protocolo não permitido: ${url.protocol}`, { hint: "apenas https:// (ou http:// com --allow-http)" });
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isPrivateHostname(hostname)) {
    return requirePrivateNetworkAllowed(url, hostname, policy, "hostname local/interno");
  }
  if (isIpLiteral(hostname)) {
    if (isPrivateAddress(hostname)) return requirePrivateNetworkAllowed(url, hostname, policy, "endereço IP privado");
    return url;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new NetworkError(`não foi possível resolver ${hostname}`, { cause: error });
  }
  if (addresses.length === 0) {
    throw new NetworkError(`não foi possível resolver ${hostname}`);
  }
  const privateAddress = addresses.find((entry) => isPrivateAddress(entry.address));
  if (privateAddress !== undefined) {
    return requirePrivateNetworkAllowed(url, privateAddress.address, policy, `endereço resolvido privado (${privateAddress.address})`);
  }
  return url;
}

function requirePrivateNetworkAllowed(url: URL, seen: string, policy: NetworkPolicy, why: string): URL {
  if (policy.allowPrivateNetwork) {
    if (isPrivateAddress(seen) || isPrivateHostname(seen)) return url;
  }
  throw new SecurityError(`destino bloqueado (${why}): ${redactUrl(url.toString())}`, {
    hint: "se for intencional, passe --allow-private-network",
    details: { hostname: seen },
  });
}

export function isPrivateHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value.endsWith(".localhost")) return true;
  if (value.endsWith(".local")) return true;
  if (value.endsWith(".internal")) return true;
  if (!value.includes(".") && !value.includes(":")) return true;
  return false;
}

export function isIpLiteral(value: string): boolean {
  if (value.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

export function isPrivateAddress(rawAddress: string): boolean {
  const value = rawAddress.trim().toLowerCase();
  if (value.includes(":")) return isPrivateIpv6(value);
  return isPrivateIpv4(value);
}

function isPrivateIpv6(value: string): boolean {
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fe80:") || value.startsWith("fec0:")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // ULA fc00::/7
  if (value.startsWith("ff")) return true; // multicast
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped?.[1] !== undefined) return isPrivateIpv4(mapped[1]);
  return false;
}

function isPrivateIpv4(value: string): boolean {
  const octets = value.split(".").map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a = 0, b = 0] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local / metadados de nuvem
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast/reservado
  return false;
}
