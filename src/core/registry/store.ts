import { StateError } from "../errors.ts";
import { readJsonIfExists, writeFileAtomic } from "../fsx.ts";
import { ensureStateDir, registryPath } from "../paths.ts";
import { withLock } from "./lock.ts";
import { emptyRegistry, validateRegistry, type Registry, type RegistryItem } from "./schema.ts";

export async function loadRegistry(): Promise<Registry> {
  const path = registryPath();
  let raw: unknown;
  try {
    raw = await readJsonIfExists<unknown>(path);
  } catch (error) {
    throw new StateError(`registro ilegível: ${path}`, {
      hint: "o arquivo não é JSON válido; restaure um backup ou remova o arquivo para começar vazio",
      cause: error,
    });
  }
  if (raw === null) return emptyRegistry();
  return validateRegistry(raw, path);
}

/** Lê, permite mutar e grava sob lock. */
export async function updateRegistry<T>(mutate: (registry: Registry) => T | Promise<T>): Promise<T> {
  return await withLock(async () => {
    const registry = await loadRegistry();
    const result = await mutate(registry);
    await writeRegistry(registry);
    return result;
  });
}

export async function saveRegistry(registry: Registry): Promise<void> {
  await withLock(async () => {
    await writeRegistry(registry);
  });
}

async function writeRegistry(registry: Registry): Promise<void> {
  validateRegistry(registry, "registro em memória");
  await ensureStateDir();
  await writeFileAtomic(registryPath(), `${JSON.stringify(registry, null, 2)}\n`, 0o600);
}

export function findItemById(registry: Registry, id: string): RegistryItem | null {
  return registry.items.find((item) => item.id === id) ?? null;
}

export function upsertItem(registry: Registry, item: RegistryItem): void {
  const index = registry.items.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    registry.items.push(item);
    return;
  }
  registry.items[index] = item;
}

export function removeItem(registry: Registry, id: string): boolean {
  const index = registry.items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  registry.items.splice(index, 1);
  return true;
}

export function uniqueItemId(registry: Registry, baseId: string): string {
  if (findItemById(registry, baseId) === null) return baseId;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseId}#${index}`;
    if (findItemById(registry, candidate) === null) return candidate;
  }
  throw new StateError(`não foi possível gerar um id único para ${baseId}`);
}
