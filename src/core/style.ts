/**
 * ANSI helpers for stderr UX. Disabled when stderr is not a TTY, when NO_COLOR is set,
 * or when FORCE_COLOR=0.
 */
export function colorEnabled(stream: { isTTY?: boolean } = process.stderr): boolean {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "") return true;
  return Boolean(stream.isTTY);
}

function wrap(code: number, text: string, enabled: boolean): string {
  if (!enabled || text.length === 0) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  green(text: string): string;
  cyan(text: string): string;
}

export function createStyle(enabled = colorEnabled()): Style {
  return {
    bold: (text) => wrap(1, text, enabled),
    dim: (text) => wrap(2, text, enabled),
    yellow: (text) => wrap(33, text, enabled),
    red: (text) => wrap(31, text, enabled),
    green: (text) => wrap(32, text, enabled),
    cyan: (text) => wrap(36, text, enabled),
  };
}
