import { createInterface } from "node:readline/promises";
import { AmbiguityError } from "./errors.ts";

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stderr.isTTY);
}

export async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, options: { defaultYes?: boolean } = {}): Promise<boolean> {
  const defaultYes = options.defaultYes ?? false;
  const suffix = defaultYes ? "[S/n]" : "[s/N]";
  const answer = (await askLine(`${question} ${suffix} `)).trim().toLowerCase();
  if (answer === "") return defaultYes;
  return answer === "s" || answer === "sim" || answer === "y" || answer === "yes";
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** Pergunta de múltipla escolha. Exige resposta explícita (nunca assume a primeira). */
export async function chooseOne<T extends string>(question: string, choices: Choice<T>[]): Promise<T> {
  if (choices.length === 0) throw new AmbiguityError(`${question}: nenhuma opção disponível`);
  process.stderr.write(`${question}\n`);
  choices.forEach((choice, index) => {
    const suffix = choice.description ? ` — ${choice.description}` : "";
    process.stderr.write(`  ${index + 1}) ${choice.label}${suffix}\n`);
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const answer = (await askLine("Escolha um número (ou 'c' para cancelar): ")).trim().toLowerCase();
    if (answer === "c" || answer === "cancelar") {
      throw new AmbiguityError("operação cancelada pelo usuário");
    }
    const index = Number.parseInt(answer, 10);
    const choice = Number.isInteger(index) ? choices[index - 1] : undefined;
    if (choice) return choice.value;
    process.stderr.write("resposta inválida\n");
  }
  throw new AmbiguityError("não foi possível obter uma escolha válida");
}

export async function askText(question: string, options: { default?: string } = {}): Promise<string> {
  const suffix = options.default ? ` [${options.default}]` : "";
  const answer = (await askLine(`${question}${suffix}: `)).trim();
  return answer === "" ? (options.default ?? "") : answer;
}
