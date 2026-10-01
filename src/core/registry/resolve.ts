import { AmbiguityError } from "../errors.ts";
import type { RegistryItem } from "./schema.ts";

export interface ItemMatch {
  item: RegistryItem;
  matchedBy: "id" | "name" | "alias";
}

export interface ArtifactIdentity {
  bundleId: string | null;
  pkgIdentifiers: string[];
  /** Nome sugerido (nome do arquivo/bundle) — nunca usado sozinho para associar. */
  displayName: string | null;
}

/** Todos os itens que casam com a consulta, sem escolher automaticamente. */
export function matchItems(items: RegistryItem[], query: string): ItemMatch[] {
  const needle = query.trim();
  if (needle.length === 0) return [];
  const lower = needle.toLowerCase();
  const matches = new Map<string, ItemMatch>();

  const add = (item: RegistryItem, matchedBy: ItemMatch["matchedBy"]): void => {
    const existing = matches.get(item.id);
    if (existing === undefined) matches.set(item.id, { item, matchedBy });
  };

  for (const item of items) if (item.id === needle) add(item, "id");
  for (const item of items) if (item.id.toLowerCase() === lower) add(item, "id");
  for (const item of items) if (item.displayName.toLowerCase() === lower) add(item, "name");
  for (const item of items) {
    if (item.aliases.some((alias) => alias.toLowerCase() === lower)) add(item, "alias");
  }
  return [...matches.values()];
}

/**
 * Resolve por id/nome/alias. Ambiguidade nunca é resolvida automaticamente.
 */
export function resolveItem(items: RegistryItem[], query: string): RegistryItem | null {
  const matches = matchItems(items, query);
  const first = matches[0];
  if (first === undefined) return null;
  if (matches.length > 1) {
    throw new AmbiguityError(`"${query}" casa com ${matches.length} itens`, {
      hint: "use o id completo para escolher",
      details: {
        candidates: matches.map((match) => ({
          id: match.item.id,
          displayName: match.item.displayName,
          matchedBy: match.matchedBy,
        })),
      },
    });
  }
  return first.item;
}

export function suggestItems(items: RegistryItem[], query: string, limit = 5): string[] {
  const lower = query.trim().toLowerCase();
  if (lower.length === 0) return items.slice(0, limit).map((item) => item.id);
  return items
    .filter((item) => {
      const haystacks = [item.id, item.displayName, ...item.aliases].map((value) => value.toLowerCase());
      return haystacks.some((value) => value.includes(lower));
    })
    .slice(0, limit)
    .map((item) => item.id);
}

/**
 * Associa um artefato inspecionado a itens existentes pela identidade real
 * (bundle id / identificadores de pacote). Nome de arquivo nunca é usado.
 */
export function findItemsByIdentity(items: RegistryItem[], identity: ArtifactIdentity): RegistryItem[] {
  const matches = new Set<RegistryItem>();
  if (identity.bundleId !== null && identity.bundleId.length > 0) {
    for (const item of items) {
      if (item.bundleId === identity.bundleId || item.id === identity.bundleId) matches.add(item);
    }
  }
  const identifiers = new Set(identity.pkgIdentifiers);
  if (identifiers.size > 0) {
    for (const item of items) {
      const itemIdentifiers = new Set<string>([item.id, ...item.receipts.map((receipt) => receipt.identifier)]);
      for (const identifier of identifiers) {
        if (itemIdentifiers.has(identifier)) {
          matches.add(item);
          break;
        }
      }
    }
  }
  return [...matches];
}

export function describeItem(item: RegistryItem): string {
  const version = item.installedVersion ?? "versão desconhecida";
  return `${item.displayName} (${item.id}, ${version})`;
}
