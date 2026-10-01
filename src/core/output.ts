export interface ReporterOptions {
  json: boolean;
  verbose: boolean;
  quiet: boolean;
}

/**
 * Saída da CLI:
 *  - stdout: apenas dados (texto formatado ou JSON)
 *  - stderr: progresso, avisos e erros
 */
export class Reporter {
  readonly options: ReporterOptions;
  private progressLine = false;

  constructor(options: ReporterOptions) {
    this.options = options;
  }

  get json(): boolean {
    return this.options.json;
  }

  get tty(): boolean {
    return Boolean(process.stderr.isTTY);
  }

  info(message: string): void {
    if (this.options.quiet) return;
    this.clearProgress();
    process.stderr.write(`${message}\n`);
  }

  verbose(message: string): void {
    if (!this.options.verbose || this.options.quiet) return;
    this.clearProgress();
    process.stderr.write(`${message}\n`);
  }

  warn(message: string): void {
    this.clearProgress();
    process.stderr.write(`aviso: ${message}\n`);
  }

  error(message: string): void {
    this.clearProgress();
    process.stderr.write(`erro: ${message}\n`);
  }

  /** Linha de progresso sobrescrita (apenas em TTY). */
  progress(message: string): void {
    if (!this.tty || this.options.quiet) return;
    process.stderr.write(`\r\x1b[2K${message}`);
    this.progressLine = true;
  }

  endProgress(): void {
    if (!this.progressLine) return;
    process.stderr.write("\n");
    this.progressLine = false;
  }

  private clearProgress(): void {
    if (this.progressLine) {
      process.stderr.write("\n");
      this.progressLine = false;
    }
  }

  /** Escreve dados no stdout (JSON estruturado quando --json). */
  data(value: unknown, render: (value: never) => void = () => {}): void {
    this.endProgress();
    if (this.json) {
      process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
      return;
    }
    render(value as never);
  }
}

export const ui = new Reporter({ json: false, verbose: false, quiet: false });

export function configureUi(options: Partial<ReporterOptions>): void {
  Object.assign(ui.options, options);
}
