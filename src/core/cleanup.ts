import { ui } from "./output.ts";

type CleanupFn = () => Promise<void> | void;

const handlers = new Set<CleanupFn>();
let signalHandlersInstalled = false;

export function registerCleanup(fn: CleanupFn): () => void {
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}

export async function runCleanups(): Promise<void> {
  const current = [...handlers].reverse();
  handlers.clear();
  for (const fn of current) {
    try {
      await fn();
    } catch {
      /* limpeza é melhor esforço */
    }
  }
}

export function installSignalHandlers(): void {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;

  const onSignal = (signal: string, code: number): void => {
    process.on(signal, () => {
      void (async () => {
        ui.error(`interrompido (${signal}); desfazendo o que for possível`);
        await runCleanups();
        process.exit(code);
      })();
    });
  };

  onSignal("SIGINT", 130);
  onSignal("SIGTERM", 143);
  onSignal("SIGHUP", 129);
}
