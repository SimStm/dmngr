/**
 * Taxonomia de erros e códigos de saída da CLI.
 *
 * 0 ok · 1 interno · 2 uso · 3 ambiguidade/decisão necessária · 4 rede
 * 5 segurança/integridade · 6 instalação · 7 estado inconsistente
 */
export const EXIT_CODES = {
  ok: 0,
  internal: 1,
  usage: 2,
  ambiguous: 3,
  network: 4,
  security: 5,
  install: 6,
  state: 7,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
export type ErrorKind = Exclude<keyof typeof EXIT_CODES, "ok">;

export interface DmngrErrorOptions {
  hint?: string;
  details?: unknown;
  cause?: unknown;
}

export class DmngrError extends Error {
  readonly kind: ErrorKind;
  readonly hint: string | undefined;
  readonly details: unknown;

  constructor(kind: ErrorKind, message: string, options: DmngrErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DmngrError";
    this.kind = kind;
    this.hint = options.hint;
    this.details = options.details;
  }

  get exitCode(): ExitCode {
    return EXIT_CODES[this.kind];
  }
}

export class InternalError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("internal", message, options);
    this.name = "InternalError";
  }
}

export class UsageError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("usage", message, options);
    this.name = "UsageError";
  }
}

export class AmbiguityError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("ambiguous", message, options);
    this.name = "AmbiguityError";
  }
}

export class NetworkError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("network", message, options);
    this.name = "NetworkError";
  }
}

export class SecurityError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("security", message, options);
    this.name = "SecurityError";
  }
}

export class InstallError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("install", message, options);
    this.name = "InstallError";
  }
}

export class StateError extends DmngrError {
  constructor(message: string, options: DmngrErrorOptions = {}) {
    super("state", message, options);
    this.name = "StateError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function toDmngrError(error: unknown): DmngrError {
  if (error instanceof DmngrError) return error;
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("commander.")) {
      return new UsageError(error.message);
    }
    return new InternalError(error.message, { cause: error });
  }
  return new InternalError(String(error));
}

export interface ErrorPayload {
  error: {
    kind: ErrorKind;
    message: string;
    status: ExitCode;
    hint?: string;
    details?: unknown;
  };
}

export function errorPayload(error: unknown): ErrorPayload {
  const dmngrError = toDmngrError(error);
  const payload: ErrorPayload = {
    error: {
      kind: dmngrError.kind,
      message: dmngrError.message,
      status: dmngrError.exitCode,
    },
  };
  if (dmngrError.hint !== undefined) payload.error.hint = dmngrError.hint;
  if (dmngrError.details !== undefined) payload.error.details = dmngrError.details;
  return payload;
}

/** Erro de decisão: exige interação e não foi possível usar o modo não interativo. */
export function decisionRequired(message: string, options: DmngrErrorOptions = {}): AmbiguityError {
  return new AmbiguityError(message, {
    hint: options.hint ?? "rode em um terminal interativo ou use as flags explícitas indicadas",
    ...options,
  });
}
